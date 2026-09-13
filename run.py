"""PaperLoom 一键启动:python run.py(在 paperloom 目录下执行)。"""
from __future__ import annotations

import threading
import webbrowser

import uvicorn

PORT = 8686


def _open_browser() -> None:
    threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()


if __name__ == "__main__":
    _open_browser()
    uvicorn.run("server.app:app", host="127.0.0.1", port=PORT, log_level="info")
