"""PaperLoom FastAPI 入口:REST API + 资产文件 + 前端静态托管。"""
from __future__ import annotations

import truststore

truststore.inject_into_ssl()  # 用系统(Windows)证书库:兼容本机 TLS 拦截/企业代理

import codecs
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.concurrency import run_in_threadpool

from . import db, jobs
from .converter.base import ConversionError, convert_pdf, load_blocks
from .render import render_standalone
from .settings import get_settings, save_settings
from .translator import translate_selection

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DOCS_DIR = DATA_DIR / "docs"
TRASH_DIR = DATA_DIR / "trash"
WEB_DIST = ROOT / "web" / "dist"

# 转换引擎按需安装:torch/docling/mineru 合计数 GB,不随安装包分发,
# 用户点「下载安装」后装进这里(用户可写目录),再挂到 sys.path。
ENGINES_DIR = DATA_DIR / "engines"

ENGINES = {"docling": "Docling(轻量快速)", "mineru": "MinerU(学术质量最佳)"}


# torch 的 c10.dll 依赖较新的 VC++ 运行库;系统那份过旧会报 WinError 1114。
# 随安装包带一份,补进各引擎的 torch/lib —— torch 会优先加载同目录下的 DLL,
# 这样用户不必自己去装 VC++ 运行库。
VC_RUNTIME_DIR = ROOT.parent / "vc-runtime"


def _engine_dirs() -> list[Path]:
    if not ENGINES_DIR.is_dir():
        return []
    return sorted(p for p in ENGINES_DIR.iterdir() if p.is_dir())


def patch_torch_dlls() -> None:
    """把随包的 VC++ 运行库补进引擎的 torch/lib。幂等:已装好的引擎下次启动就地修好。"""
    if not VC_RUNTIME_DIR.is_dir():
        return
    dlls = list(VC_RUNTIME_DIR.glob("*.dll"))
    if not dlls:
        return
    for engine_dir in _engine_dirs():
        lib = engine_dir / "torch" / "lib"
        if not lib.is_dir():
            continue
        for dll in dlls:
            dst = lib / dll.name
            try:
                if not dst.exists() or dst.stat().st_size != dll.stat().st_size:
                    shutil.copy2(dll, dst)
            except Exception:
                pass


def sync_engine_paths() -> None:
    """把已下载的引擎目录挂到 sys.path 与 PYTHONPATH。

    本进程靠 sys.path 才能 find_spec 到引擎;转换 worker 是用 sys.executable
    起的子进程(docling 不传 env、mineru 传 dict(os.environ)),两者都从
    os.environ 继承 PYTHONPATH,所以这一处设置就够。
    """
    dirs = _engine_dirs()
    if not dirs:
        return
    for d in dirs:
        if str(d) not in sys.path:
            sys.path.append(str(d))
    extra = os.pathsep.join(str(d) for d in dirs)
    cur = os.environ.get("PYTHONPATH", "")
    if extra not in cur:
        os.environ["PYTHONPATH"] = f"{extra}{os.pathsep}{cur}" if cur else extra


def _find_uv() -> str | None:
    """定位 uv:优先随安装包携带的,其次系统 PATH。"""
    for cand in (os.environ.get("PL_UV", ""), str(ROOT / "uv.exe"), str(ROOT.parent / "uv.exe")):
        if cand and Path(cand).is_file():
            return cand
    return shutil.which("uv")


# 引擎包默认从 pypi.org 下载,国内直连很慢;这里给几个常用镜像
PYPI_MIRRORS = {
    "tsinghua": "https://pypi.tuna.tsinghua.edu.cn/simple",
    "aliyun": "https://mirrors.aliyun.com/pypi/simple/",
    "ustc": "https://mirrors.ustc.edu.cn/pypi/simple",
    "tencent": "https://mirrors.cloud.tencent.com/pypi/simple",
}


def _pypi_index() -> str:
    """返回要用的包索引地址;空串表示走 uv 默认(官方 PyPI)。"""
    v = str(get_settings().get("pypi_index") or "").strip()
    return PYPI_MIRRORS.get(v, v)  # 不在预设里就当自定义 URL 用


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    sync_engine_paths()  # 已下载的转换引擎要在本进程里可导入
    patch_torch_dlls()   # 顺带把 VC++ 运行库补进已装引擎(修旧系统的 WinError 1114)
    # 服务重启会中断后台线程:把卡在执行态的文档恢复为可继续的状态
    for d in db.list_docs():
        if d["status"] == "converting":
            db.update_doc(d["id"], status="failed", stage="失败",
                          error="服务重启,转换被中断,请重试")
        elif d["status"] == "translating":
            db.update_doc(d["id"], status="cancelled", stage="服务重启,已完成部分已保留")
    yield


app = FastAPI(title="PaperLoom", lifespan=lifespan)
# 只放行本机来源。原来用 allow_origins=["*"] —— 那意味着用户浏览任意网站时,
# 对方页面都能跨域 fetch 这个本地服务,把 /api/settings 里的 API Key 读走。
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _doc_dir(doc_id: str) -> Path:
    d = DOCS_DIR / doc_id
    if not d.is_dir() or not db.get_doc(doc_id):
        raise HTTPException(404, "文档不存在")
    return d


# ---------------- 文档 ----------------

@app.post("/api/docs/upload")
async def upload(files: list[UploadFile] = File(...)):
    created = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            continue
        doc_id = uuid.uuid4().hex[:10]
        d = DOCS_DIR / doc_id
        d.mkdir(parents=True, exist_ok=True)
        dest = d / "origin.pdf"
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        db.create_doc(doc_id, f.filename)
        created.append({"id": doc_id, "filename": f.filename})
    if not created:
        raise HTTPException(400, "未收到有效的 PDF 文件")
    return created


def _parse_tags(d: dict) -> dict:
    try:
        d["tags"] = json.loads(d.get("tags") or "[]")
    except Exception:
        d["tags"] = []
    return d


MAX_SEGMENT = 60
MAX_DEPTH = 10
MAX_PATH = 300


def _clean_path(raw) -> str:
    """校验文件夹路径,返回规范化结果。'' 表示根目录。非法一律 400 —— 不截断。

    截断会把嵌套路径从中间切断,存下一个并不存在的路径;宁可报错。
    """
    path = str(raw or "").strip()
    if not path:
        return ""
    if len(path) > MAX_PATH:
        raise HTTPException(400, "路径过长")
    parts = path.split("/")
    if len(parts) > MAX_DEPTH:
        raise HTTPException(400, f"层级过深(最多 {MAX_DEPTH} 层)")
    for s in parts:
        if not s or s != s.strip() or s in (".", "..") or "\\" in s or any(ord(ch) < 32 for ch in s):
            raise HTTPException(400, "文件夹名称无效")
        if len(s) > MAX_SEGMENT:
            raise HTTPException(400, f"单级名称过长(最多 {MAX_SEGMENT} 字)")
    return "/".join(parts)


@app.get("/api/docs")
def list_docs():
    return [_parse_tags(d) for d in db.list_docs()]


@app.get("/api/docs/{doc_id}")
def get_doc(doc_id: str):
    meta = db.get_doc(doc_id)
    if not meta:
        raise HTTPException(404, "文档不存在")
    return _parse_tags(meta)


@app.patch("/api/docs/{doc_id}")
def patch_doc(doc_id: str, body: dict):
    if not db.get_doc(doc_id):
        raise HTTPException(404, "文档不存在")
    fields = {}
    if body and "folder" in body:
        fields["folder"] = _clean_path(body["folder"])
        db.ensure_folders(fields["folder"])
    if body and "tags" in body:
        tags = [str(t).strip()[:24] for t in (body["tags"] or []) if str(t).strip()][:20]
        fields["tags"] = json.dumps(list(dict.fromkeys(tags)), ensure_ascii=False)
    if fields:
        db.update_doc(doc_id, **fields)
    return _parse_tags(db.get_doc(doc_id))


@app.post("/api/docs/move")
def move_docs(body: dict):
    """批量移动文档(单事务)。逐条 PATCH 会在中途失败时留下半移动状态。"""
    ids = [str(x) for x in ((body or {}).get("ids") or [])]
    to = _clean_path((body or {}).get("to"))
    if not ids:
        raise HTTPException(400, "未指定要移动的文档")
    found = [i for i in ids if db.get_doc(i)]
    if not found:
        raise HTTPException(404, "文档不存在")
    db.ensure_folders(to)
    return {"ok": True, "moved": db.move_docs(found, to)}


# ---------------- 文件夹 ----------------

@app.get("/api/folders")
def list_folders():
    return db.list_folders()


@app.post("/api/folders")
def create_folder(body: dict):
    path = _clean_path((body or {}).get("path"))
    if not path:
        raise HTTPException(400, "文件夹名称不能为空")
    if not db.create_folder(path):
        raise HTTPException(409, "文件夹已存在")
    return {"ok": True, "path": path}


@app.patch("/api/folders")
def rename_folder(body: dict):
    """重命名或移动整棵子树。"""
    path = _clean_path((body or {}).get("path"))
    to = _clean_path((body or {}).get("to"))
    if not path or not to:
        raise HTTPException(400, "缺少文件夹路径")
    if path == to:
        raise HTTPException(400, "名称未变化")
    if to.startswith(path + "/"):
        raise HTTPException(400, "不能把文件夹移入它自己")
    if not db.folder_exists(path):
        raise HTTPException(404, "文件夹不存在")
    if db.folder_exists(to):
        raise HTTPException(409, "目标位置已有同名文件夹")
    db.rename_prefix(path, to)
    return {"ok": True, "path": to}


@app.delete("/api/folders")
def delete_folder(path: str = ""):
    """删除文件夹 = 折叠进它的上一级:子文件夹与文档的相对结构完整保留,只少一层。"""
    p = _clean_path(path)
    if not p:
        raise HTTPException(400, "不能删除根目录")
    if not db.folder_exists(p):
        raise HTTPException(404, "文件夹不存在")
    db.rename_prefix(p, p.rsplit("/", 1)[0] if "/" in p else "")
    return {"ok": True}


@app.delete("/api/docs/{doc_id}")
def remove_doc(doc_id: str):
    _doc_dir(doc_id)
    # 不直接删除:整体移入 data/trash/<时间戳>_<id> 备份
    dest = TRASH_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}_{doc_id}"
    TRASH_DIR.mkdir(parents=True, exist_ok=True)
    shutil.move(str(DOCS_DIR / doc_id), str(dest))
    db.delete_doc(doc_id)
    return {"ok": True, "trash": str(dest)}


@app.post("/api/docs/{doc_id}/convert")
def convert(doc_id: str, body: dict):
    meta = db.get_doc(doc_id)
    if not meta or not (DOCS_DIR / doc_id).is_dir():
        raise HTTPException(404, "文档不存在")
    engine = (body or {}).get("engine", "docling")
    if engine not in ENGINES:
        raise HTTPException(400, f"未知引擎: {engine}")
    if meta["status"] in ("converting", "translating"):
        raise HTTPException(409, "当前有任务进行中")
    if not jobs.submit(doc_id, "convert", engine=engine):
        raise HTTPException(409, "该文档已有排队任务")
    return {"ok": True, "engine": engine}


@app.post("/api/docs/{doc_id}/translate")
def translate(doc_id: str, body: dict | None = None):
    meta = db.get_doc(doc_id)
    if not meta or not (DOCS_DIR / doc_id).is_dir():
        raise HTTPException(404, "文档不存在")
    if meta["status"] in ("converting", "translating"):
        raise HTTPException(409, "当前有任务进行中")
    if not (DOCS_DIR / doc_id / "blocks.json").exists():
        raise HTTPException(400, "请先完成 PDF 转换")
    s = get_settings()
    if not s.get("api_key"):
        raise HTTPException(400, "请先在设置页配置 LLM API Key")
    mode = (body or {}).get("mode", "auto")  # auto=增量续翻 force=全部重翻
    if not jobs.submit(doc_id, "translate", only_missing=(mode != "force")):
        raise HTTPException(409, "该文档已有排队任务")
    return {"ok": True, "mode": mode}


@app.post("/api/docs/{doc_id}/retry")
def retry_blocks(doc_id: str, body: dict):
    _doc_dir(doc_id)
    ids = [str(x) for x in ((body or {}).get("block_ids") or [])]
    if not ids:
        raise HTTPException(400, "未指定要重译的块")
    s = get_settings()
    if not s.get("api_key"):
        raise HTTPException(400, "请先在设置页配置 LLM API Key")
    if not jobs.submit(doc_id, "translate", only_missing=False, only_ids=ids):
        raise HTTPException(409, "该文档已有排队任务")
    return {"ok": True, "count": len(ids)}


@app.post("/api/docs/{doc_id}/cancel")
def cancel_doc(doc_id: str):
    _doc_dir(doc_id)
    return {"ok": jobs.request_cancel(doc_id)}


# ---------------- 批注 / 划词翻译 ----------------

@app.get("/api/docs/{doc_id}/annotations")
def annotations(doc_id: str):
    _doc_dir(doc_id)
    return db.list_annotations(doc_id)


@app.post("/api/docs/{doc_id}/annotations")
def add_annotation(doc_id: str, body: dict):
    _doc_dir(doc_id)
    block_id = str((body or {}).get("block_id", ""))
    start, end = int(body.get("start", 0)), int(body.get("end", 0))
    if not block_id or end <= start:
        raise HTTPException(400, "批注位置无效")
    kind = body.get("kind", "highlight")
    if kind not in ("highlight", "underline"):
        raise HTTPException(400, "kind 应为 highlight|underline")
    color = body.get("color", "yellow")
    if color not in ("yellow", "green", "blue", "pink"):
        raise HTTPException(400, "color 应为 yellow|green|blue|pink")
    ann = db.add_annotation(
        uuid.uuid4().hex[:10], doc_id, block_id, start, end,
        kind, color, str(body.get("note", "") or ""),
    )
    db.touch_doc(doc_id)
    return ann


@app.put("/api/docs/{doc_id}/annotations/{ann_id}")
def edit_annotation(doc_id: str, ann_id: str, body: dict):
    _doc_dir(doc_id)
    fields = {}
    for k in ("note", "color", "kind"):
        if body and k in body:
            fields[k] = body[k]
    db.update_annotation(doc_id, ann_id, **fields)
    if fields:
        db.touch_doc(doc_id)
    return {"ok": True}


@app.delete("/api/docs/{doc_id}/annotations/{ann_id}")
def remove_annotation(doc_id: str, ann_id: str):
    _doc_dir(doc_id)
    db.delete_annotation(doc_id, ann_id)
    db.touch_doc(doc_id)
    return {"ok": True}


@app.post("/api/docs/{doc_id}/selection-translate")
async def selection_translate(doc_id: str, body: dict):
    _doc_dir(doc_id)
    text = str((body or {}).get("text", "")).strip()
    if not text:
        raise HTTPException(400, "未提供选中文本")
    s = get_settings()
    if not s.get("api_key"):
        raise HTTPException(400, "请先在设置页配置 LLM API Key")
    try:
        zh = await run_in_threadpool(translate_selection, text)
    except Exception as e:
        detail = getattr(e, "response", None)
        msg = detail.text[:200] if detail is not None and hasattr(detail, "text") else str(e)
        raise HTTPException(500, f"翻译失败:{msg}")
    return {"zh": zh}


@app.get("/api/docs/{doc_id}/content")
def content(doc_id: str):
    _doc_dir(doc_id)
    try:
        engine, blocks = load_blocks(DOCS_DIR / doc_id)
    except FileNotFoundError:
        return {"engine": None, "blocks": []}
    return {
        "engine": engine,
        "blocks": [b.to_dict() for b in blocks],
    }


@app.get("/api/docs/{doc_id}/html")
def doc_html(doc_id: str, variant: str = "dual"):
    _doc_dir(doc_id)
    if variant not in ("origin", "translated", "dual"):
        raise HTTPException(400, "variant 应为 origin|translated|dual")
    meta = db.get_doc(doc_id)
    try:
        path = render_standalone(DOCS_DIR / doc_id, variant, meta["filename"])
    except FileNotFoundError:
        raise HTTPException(400, "请先完成 PDF 转换")
    return FileResponse(path, media_type="text/html")


# 无头浏览器:优先 Edge(Windows 自带),退到 Chrome。用于「直接另存为 PDF」,
# 复用打印样式表排版,不走浏览器打印对话框。
_BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def _find_browser() -> str | None:
    for p in _BROWSERS:
        if Path(p).is_file():
            return p
    for name in ("msedge", "chrome", "chromium", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


@app.get("/api/docs/{doc_id}/pdf")
def doc_pdf(doc_id: str, request: Request, variant: str = "dual"):
    """用无头 Edge/Chrome 把独立 HTML 打印成 PDF —— 矢量文字,可选中可搜索。"""
    _doc_dir(doc_id)
    if variant not in ("origin", "translated", "dual"):
        raise HTTPException(400, "variant 应为 origin|translated|dual")
    meta = db.get_doc(doc_id)
    try:
        render_standalone(DOCS_DIR / doc_id, variant, meta["filename"])
    except FileNotFoundError:
        raise HTTPException(400, "请先完成 PDF 转换")

    browser = _find_browser()
    if not browser:
        raise HTTPException(500, "未找到 Edge 或 Chrome,无法生成 PDF")

    # 走 HTTP 而不是本地文件:这样 HTML 里的 assets/ 相对路径能正确加载图片
    url = f"{str(request.base_url).rstrip('/')}/files/{doc_id}/{variant}.html"
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "out.pdf"
        try:
            proc = subprocess.run(
                [
                    browser,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-pdf-header-footer",
                    "--virtual-time-budget=8000",  # 等图片和字体加载完
                    f"--print-to-pdf={out}",
                    url,
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(500, "PDF 生成超时")
        if not out.is_file() or out.stat().st_size == 0:
            tail = (proc.stderr or "")[-300:]
            raise HTTPException(500, f"PDF 生成失败:{tail}")
        data = out.read_bytes()  # 必须在 with 块内读:离开后临时目录就被删了

    name = (meta["filename"] or doc_id).rsplit(".", 1)[0] + ".pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


@app.get("/api/engines")
def engines():
    import importlib.metadata as im
    import importlib.util as iu

    def info(name: str) -> dict:
        installed = iu.find_spec(name) is not None
        version = ""
        if installed:
            try:
                version = im.version(name)
            except Exception:
                version = "?"
        return {"installed": installed, "version": version}

    return {
        "docling": info("docling"),
        "mineru": info("mineru"),
        "install": dict(ENGINE_INSTALL),
    }


# 引擎后台安装状态: {engine: {running, ok, error, log}}
ENGINE_INSTALL: dict = {}


@app.post("/api/engines/{engine}/install")
async def install_engine(engine: str):
    import subprocess as _sp
    import threading as _th

    if engine not in ENGINES:
        raise HTTPException(400, "未知引擎")
    st = ENGINE_INSTALL.get(engine) or {}
    if st.get("running"):
        return {"ok": True, "message": "已在安装中"}

    uv = _find_uv()
    if not uv:
        raise HTTPException(500, "未找到 uv,无法自动安装引擎")

    spec = "docling" if engine == "docling" else "mineru[pipeline]"
    target = ENGINES_DIR / engine
    target.mkdir(parents=True, exist_ok=True)
    # 装进用户可写的 data/engines/<engine>,不碰随包携带的 site-packages。
    # --link-mode=copy:缓存与目标目录可能不同盘,硬链接会失败并告警。
    cmd = [
        uv, "pip", "install", "--native-tls", "--link-mode", "copy",
        "--python", sys.executable,
        "--target", str(target),
    ]
    index = _pypi_index()
    if index:
        cmd += ["--default-index", index]
    cmd.append(spec)

    def _run():
        state = ENGINE_INSTALL.setdefault(engine, {})
        state.update(running=True, ok=False, error="", log="")
        try:
            proc = _sp.Popen(cmd, stdout=_sp.PIPE, stderr=_sp.STDOUT)
            # uv 的进度条用 \r 原地刷新、不换行;按行读会一直等换行,日志就卡住不动。
            # 所以直接读原始字节,把 \r 也当换行拆开。
            dec = codecs.getincrementaldecoder("utf-8")("replace")
            buf = ""
            fd = proc.stdout.fileno()
            while True:
                chunk = os.read(fd, 4096)
                if not chunk:
                    break
                buf += dec.decode(chunk).replace("\r", "\n")
                parts = buf.split("\n")
                buf = parts.pop()
                for ln in parts:
                    ln = ln.strip()
                    if ln:
                        state["log"] = (state["log"] + ln + "\n")[-4000:]
            proc.wait()
            state["ok"] = proc.returncode == 0
            if state["ok"]:
                sync_engine_paths()  # 装完立刻可用,不需要重启
                patch_torch_dlls()
                state["log"] += "\n✓ 安装完成,现在可以在文库页选用。"
            else:
                state["error"] = f"安装失败(退出码 {proc.returncode}),详见日志"
        except Exception as e:
            state["error"] = str(e)
        finally:
            state["running"] = False

    _th.Thread(target=_run, daemon=True).start()
    return {"ok": True, "message": "开始后台安装"}


# ---------------- 设置 ----------------

@app.get("/api/settings")
def read_settings():
    return get_settings()


@app.put("/api/settings")
def write_settings(patch: dict):
    return save_settings(patch or {})


@app.post("/api/settings/test")
async def test_settings():
    s = get_settings()
    if not s.get("api_key"):
        return {"ok": False, "message": "请先填写 API Key"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                s["base_url"].rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {s['api_key']}"},
                json={
                    "model": s["model"],
                    "messages": [{"role": "user", "content": "请只回复:OK"}],
                    "max_tokens": 10,
                },
            )
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
        return {"ok": True, "message": f"连接成功,模型回复:{text.strip()[:50]}"}
    except Exception as e:
        detail = getattr(e, "response", None)
        msg = detail.text[:200] if detail is not None and hasattr(detail, "text") else str(e)
        return {"ok": False, "message": f"连接失败:{msg}"}


# ---------------- 资产与前端 ----------------

@app.get("/files/{doc_id}/{rel_path:path}")
def asset(doc_id: str, rel_path: str):
    base = (DOCS_DIR / doc_id).resolve()
    target = (base / rel_path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(404)
    # 独立 HTML 按需生成(相对路径引用 assets/,以 /files/ 提供才能正确加载图片)
    if target.name in ("origin.html", "translated.html", "dual.html") and not target.exists():
        if (base / "blocks.json").exists():
            meta = db.get_doc(doc_id) or {}
            render_standalone(base, target.name.replace(".html", ""), meta.get("filename", doc_id))
    if not target.is_file():
        raise HTTPException(404)
    return FileResponse(target)


if WEB_DIST.is_dir():
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        # SPA 回退:静态文件存在则直接返回,否则交给前端路由(如 /reader/:id)
        candidate = (WEB_DIST / full_path).resolve()
        if full_path and str(candidate).startswith(str(WEB_DIST.resolve())) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
else:  # 开发模式下前端由 Vite 独立服务
    @app.get("/")
    def index():
        return JSONResponse({"app": "PaperLoom API", "docs": "/api/docs"})


@app.exception_handler(ConversionError)
async def conv_err(_req, exc: ConversionError):
    return JSONResponse({"detail": str(exc)}, status_code=500)
