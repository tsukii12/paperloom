"""MinerU 转换后端:本地 mineru-api(pipeline 后端)→ content_list.json → Block 列表。

首次运行会下载模型(默认走 ModelScope 源,国内网络稳定)。
Windows 注意:cv2 先于 torch 初始化会段错误,因此所有 mineru 子进程都用
"先 import torch" 的引导代码启动,并由我们自行拉起 API 服务(CLI 不再自启)。
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from .base import Block, ConversionCancelled, ConversionError, ProgressFn


def _cancelled() -> Exception:
    return ConversionCancelled()


def _start_api(env: dict, cancel_check=None) -> tuple[subprocess.Popen, int]:
    """以 torch 优先的引导方式启动 mineru-api,等待 /health 就绪。"""
    import threading

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    code = (
        "import truststore, ssl, torch, uvicorn; "
        "truststore.inject_into_ssl(); "
        "from mineru.cli.fast_api import app; "
        f"uvicorn.run(app, host='127.0.0.1', port={port}, log_level='warning')"
    )
    proc = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-c", code],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace",
    )
    watcher = threading.Thread(target=lambda: proc.stderr and proc.stderr.read(), daemon=True)
    watcher.start()  # 防止 stderr 管道写满阻塞

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.time() + 180
    while time.time() < deadline:
        if cancel_check is not None and cancel_check():
            proc.kill()
            from .base import ConversionCancelled

            raise ConversionCancelled()
        if proc.poll() is not None:
            raise ConversionError("mineru-api 启动即退出(可能缺少依赖)")
        try:
            with opener.open(f"http://127.0.0.1:{port}/health", timeout=3) as r:
                if r.status == 200:
                    return proc, port
        except Exception:
            time.sleep(1.0)
    proc.kill()
    raise ConversionError("mineru-api 健康检查超时(180s)")


class _TableHTMLParser(HTMLParser):
    """从 table_body HTML 中提取二维单元格文本(忽略合并单元格的跨行跨列)。"""

    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] = []
        self._in_cell = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr" and self._row is None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._in_cell = True
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._in_cell:
            self._row.append("".join(self._cell).strip())
            self._in_cell = False
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._in_cell:
            self._cell.append(data)


def _parse_table_html(html: str) -> list[list[str]]:
    p = _TableHTMLParser()
    try:
        p.feed(html or "")
    except Exception:
        return []
    return [r for r in p.rows if r]


def convert(
    pdf_path: Path, doc_dir: Path, progress: ProgressFn, cancel_check=None
) -> list[Block]:
    try:
        import importlib.util as _iu

        if _iu.find_spec("mineru") is None:
            raise ImportError
    except ImportError as e:
        raise ConversionError(
            "MinerU 引擎尚未安装,请到「设置 → 转换引擎」点「下载安装」。"
        ) from e

    progress("启动 MinerU(首次运行需下载模型)…", 0.05)
    outdir = doc_dir / "_mineru_out"
    outdir.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    # 模型下载源:settings.json 的 model_source(hf-mirror | modelscope | huggingface)
    from ..settings import get_settings

    src = str(get_settings().get("model_source") or "hf-mirror").strip().lower()
    if src == "hf-mirror":
        env["MINERU_MODEL_SOURCE"] = "huggingface"
        env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    else:
        env["MINERU_MODEL_SOURCE"] = src

    api_proc, port = _start_api(env, cancel_check=cancel_check)
    try:
        # CLI 本体同样引导(torch 优先 + 系统证书);--api-url 指向我们自己的 API
        bootstrap = (
            "import sys, truststore, ssl, torch; "
            "truststore.inject_into_ssl(); "
            "from mineru.cli.client import main; main(sys.argv[1:])"
        )
        cmd = [
            sys.executable, "-X", "utf8", "-c", bootstrap,
            "-p", str(pdf_path), "-o", str(outdir), "-b", "pipeline",
            "--api-url", f"http://127.0.0.1:{port}",
        ]
        proc = subprocess.Popen(
            cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            cwd=str(outdir),
        )
        # 轮询等待,期间响应取消
        while proc.poll() is None:
            if cancel_check is not None and cancel_check():
                proc.kill()
                raise _cancelled()
            time.sleep(0.5)
        if proc.returncode != 0:
            tail = (proc.stderr.read() or "")[-1200:]
            raise ConversionError(f"MinerU 转换失败:\n{tail}")
    finally:
        api_proc.terminate()
        try:
            api_proc.wait(timeout=10)
        except Exception:
            api_proc.kill()

    progress("解析 MinerU 输出…", 0.9)
    cl_files = sorted(outdir.rglob("*_content_list.json"))
    if not cl_files:
        raise ConversionError("MinerU 未生成 content_list.json")
    content = json.loads(cl_files[0].read_text(encoding="utf-8"))
    src_dir = cl_files[0].parent

    assets = doc_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    blocks: list[Block] = []
    for it in content:
        try:
            t = it.get("type")
            page = int(it.get("page_idx", 0)) + 1
            if t == "text":
                text = (it.get("text") or "").strip()
                if not text:
                    continue
                if it.get("text_level") == 1:
                    blocks.append(Block(type="title", text=text, level=1, page=page))
                else:
                    blocks.append(Block(type="text", text=text, page=page))
            elif t == "image":
                img = it.get("img_path")
                if img:
                    src = src_dir / img
                    if src.exists():
                        dest = assets / src.name
                        if not dest.exists():
                            shutil.copy2(src, dest)
                        blocks.append(Block(type="image", img=f"assets/{src.name}", page=page))
                for cap in it.get("img_caption", []) or []:
                    if cap.strip():
                        blocks.append(Block(type="caption", text=cap.strip(), page=page))
            elif t == "table":
                cells = _parse_table_html(it.get("table_body") or "")
                if cells:
                    header_rows = 1 if "<th" in (it.get("table_body") or "").lower()[:400] else 0
                    blocks.append(Block(type="table", cells=cells, header_rows=header_rows, page=page))
                for cap in it.get("table_caption", []) or []:
                    if cap.strip():
                        blocks.append(Block(type="caption", text=cap.strip(), page=page))
            elif t == "equation":
                latex = (it.get("text") or "").strip().strip("$").strip()
                if latex:
                    blocks.append(Block(type="equation", latex=latex, page=page))
        except Exception:
            continue

    if not blocks:
        raise ConversionError("MinerU 输出为空")
    return blocks
