"""后台任务队列:双通道设计。

- 转换通道:CPU 密集(Docling/MinerU),串行执行
- 翻译通道:网络密集(LLM API),串行调度但与转换互不阻塞,单请求并发由设置控制

支持取消:cancel_flags 中登记的文档在批次/页边界中止(已译部分保留)。
同一文档同时只会有一项排队任务(防止状态互相踩踏)。
"""
from __future__ import annotations

import pathlib
import queue
import threading
import traceback

from . import db
from .converter.base import ConversionCancelled, convert_pdf, load_blocks, save_blocks
from .translator import TransCancelled, translate_blocks

_q_convert: "queue.Queue[tuple]" = queue.Queue()
_q_translate: "queue.Queue[tuple]" = queue.Queue()
_started = False
_lock = threading.Lock()
_cancel_flags: set[str] = set()
_pending: set[str] = set()


class JobCancelled(Exception):
    pass


def _finish(doc_id: str) -> None:
    with _lock:
        _pending.discard(doc_id)
        _cancel_flags.discard(doc_id)


def _worker(kind: str, q: "queue.Queue[tuple]") -> None:
    while True:
        doc_id, opts = q.get()
        try:
            if is_cancelled(doc_id):
                raise JobCancelled()
            if kind == "convert":
                _run_convert(doc_id, opts)
            else:
                _run_translate(doc_id, opts)
        except (JobCancelled, ConversionCancelled, TransCancelled) as e:
            stage = f"已取消 · {e}" if str(e) else "已取消(保留已完成部分)"
            db.append_log(doc_id, stage)
            db.update_doc(doc_id, status="cancelled", stage=stage)
        except Exception:
            err = traceback.format_exc()[-1500:]
            try:
                db.append_log(doc_id, "失败:")
                db.append_log(doc_id, err[-800:])
                db.update_doc(doc_id, status="failed", stage="失败", error=err)
            except Exception:
                pass
        finally:
            _finish(doc_id)
            q.task_done()


def _start() -> None:
    global _started
    with _lock:
        if not _started:
            threading.Thread(target=_worker, args=("convert", _q_convert), daemon=True,
                             name="paperloom-convert").start()
            threading.Thread(target=_worker, args=("translate", _q_translate), daemon=True,
                             name="paperloom-translate").start()
            _started = True


def is_cancelled(doc_id: str) -> bool:
    with _lock:
        return doc_id in _cancel_flags


def request_cancel(doc_id: str) -> bool:
    """登记取消;排队中或执行中的任务返回 True。"""
    meta = db.get_doc(doc_id)
    if not meta:
        return False
    with _lock:
        active = meta["status"] in ("queued", "converting", "translating")
        if not active and doc_id not in _pending:
            return False
        _cancel_flags.add(doc_id)
    db.update_doc(doc_id, stage="取消中…")
    return True


def _run_convert(doc_id: str, opts: dict) -> None:
    engine = opts.get("engine") or db.get_doc(doc_id)["engine"] or "docling"
    doc_dir = pathlib.Path(__file__).resolve().parent.parent / "data" / "docs" / doc_id
    pdf = doc_dir / "origin.pdf"
    db.update_doc(doc_id, status="converting", progress=0.0, stage="准备中", error="")
    db.append_log(doc_id, f"开始转换 · 引擎 {engine}")

    last = ""

    def progress(stage: str, p: float) -> None:
        nonlocal last
        if is_cancelled(doc_id):
            raise JobCancelled()
        # 只在阶段文字变化时记一行 —— 进度百分比每批都在跳,全记下来会把日志冲爆
        if stage != last:
            last = stage
            db.append_log(doc_id, stage)
        db.update_doc(doc_id, stage=stage, progress=max(0.0, min(1.0, p)))

    def cancel_check() -> bool:
        return is_cancelled(doc_id)

    blocks = convert_pdf(engine, pdf, doc_dir, progress, cancel_check=cancel_check)
    save_blocks(doc_dir, engine, blocks)
    n_pages = max((b.page for b in blocks), default=0)
    db.append_log(doc_id, f"转换完成 · 共 {len(blocks)} 个内容块 / {n_pages} 页")
    db.update_doc(
        doc_id,
        status="ready",
        progress=1.0,
        stage=f"共 {len(blocks)} 个内容块 / {n_pages} 页",
        n_pages=n_pages,
        error="",
    )


def _run_translate(doc_id: str, opts: dict) -> None:
    doc_dir = pathlib.Path(__file__).resolve().parent.parent / "data" / "docs" / doc_id
    engine, blocks = load_blocks(doc_dir)
    db.update_doc(doc_id, status="translating", progress=0.0, stage="准备翻译", error="")
    db.append_log(doc_id, "开始翻译")

    last = ""

    def progress(p: float, stage: str) -> None:
        nonlocal last
        if stage != last:
            last = stage
            db.append_log(doc_id, stage)
        db.update_doc(doc_id, stage=stage, progress=max(0.0, min(1.0, p)))

    n, _units = translate_blocks(
        blocks,
        progress,
        persist=lambda: save_blocks(doc_dir, engine, blocks),
        cancel_check=lambda: is_cancelled(doc_id),
        only_missing=opts.get("only_missing", True),
        only_ids=opts.get("only_ids"),
    )
    save_blocks(doc_dir, engine, blocks)
    ok = sum(1 for b in blocks if b.zh or b.zh_items or b.zh_cells)
    has_err = any(b.error for b in blocks)
    if n == 0 and not has_err:
        stage = "无需翻译(已全部完成)"
    elif opts.get("only_ids"):
        stage = f"已重译 {n} 块"
    else:
        stage = f"已翻译 {ok}/{len(blocks)} 块" + ("(部分失败,可在阅读页重试)" if has_err else "")
    db.append_log(doc_id, stage)
    db.update_doc(doc_id, status="done", progress=1.0, stage=stage, error="")


def submit(doc_id: str, kind: str, *, engine: str | None = None,
           only_missing: bool = True, only_ids: list[str] | None = None) -> bool:
    """入队;同一文档已有排队任务时返回 False。"""
    with _lock:
        if doc_id in _pending:
            return False
        _pending.add(doc_id)
    try:
        # 立即持久化排队态，前端可持续轮询；否则队列间隙会被误判为全部完成。
        label = "转换" if kind == "convert" else "翻译"
        db.clear_log(doc_id)
        db.append_log(doc_id, f"已排入{label}队列")
        fields = {"status": "queued", "stage": f"排队等待{label}", "progress": 0.0, "error": ""}
        if engine:
            fields["engine"] = engine
        db.update_doc(doc_id, **fields)
        opts: dict = {"only_missing": only_missing}
        if only_ids:
            opts["only_ids"] = set(only_ids)
        if engine:
            opts["engine"] = engine
        _start()
        (_q_convert if kind == "convert" else _q_translate).put((doc_id, opts))
        return True
    except Exception:
        with _lock:
            _pending.discard(doc_id)
        raise
