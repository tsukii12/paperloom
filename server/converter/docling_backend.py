"""Docling 转换后端:以子进程逐页运行 docling_worker.py。

子进程逐页输出进度(PROG i/n),父进程解析并写库;取消时 kill 子进程,
最多损失当前页——转换过程中随时可取消,且进度条是真实的每页进度。
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

from .base import Block, ConversionCancelled, ConversionError, ProgressFn

WORKER = Path(__file__).resolve().parent / "docling_worker.py"


def convert(
    pdf_path: Path, doc_dir: Path, progress: ProgressFn, cancel_check=None
) -> list[Block]:
    import importlib.util as _iu

    if _iu.find_spec("docling") is None:
        raise ConversionError(
            "Docling 引擎尚未安装,请到「设置 → 转换引擎」点「下载安装」。"
        )

    progress("启动 Docling(首次运行需下载模型)…", 0.02)
    out = doc_dir / "_docling_partial.json"
    assets = doc_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    # 模型下载源:与 MinerU 共用 settings.json 的 model_source。
    # Docling 只走 HuggingFace,选 modelscope 时按 huggingface 处理。
    from ..settings import get_settings

    env = dict(os.environ)
    if str(get_settings().get("model_source") or "") == "hf-mirror":
        env.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

    proc = subprocess.Popen(
        [
            sys.executable, "-X", "utf8", str(WORKER),
            str(pdf_path), str(assets), str(out),
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(WORKER.parent.parent.parent),  # paperloom/
    )
    assert proc.stdout and proc.stderr
    err_tail: list[str] = []
    threading.Thread(
        target=lambda: err_tail.extend(
            [l for l in proc.stderr.read().splitlines()[-8:]] if proc.stderr else []
        ),
        daemon=True,
    ).start()

    lines: "queue.Queue[str]" = queue.Queue()
    threading.Thread(
        target=lambda: [lines.put(l) for l in iter(proc.stdout.readline, "")],
        daemon=True,
    ).start()

    def _cancelled() -> bool:
        return cancel_check is not None and cancel_check()

    n_total = 0
    while True:
        if _cancelled():
            proc.kill()
            raise ConversionCancelled()
        try:
            line = lines.get(timeout=0.4)
        except queue.Empty:
            if proc.poll() is not None:
                # 进程退出前再确认一次取消标志
                if _cancelled():
                    raise ConversionCancelled()
                break
            continue
        line = line.strip()
        if line.startswith("PROG"):
            try:
                i, n = line[4:].split("/")
                n_total = int(n)
                progress(f"转换中 第 {i}/{n} 页", int(i) / max(1, int(n)) * 0.97)
            except ValueError:
                pass

    rc = proc.wait()
    if rc != 0:
        tail = "\n".join(err_tail)[-1200:] or f"退出码 {rc}"
        raise ConversionError(f"Docling 转换失败:\n{tail}")
    if not out.exists():
        raise ConversionError("Docling 未产出结果文件")
    data = json.loads(out.read_text(encoding="utf-8"))
    progress("整理内容块…", 0.98)
    return data.get("blocks", [])
