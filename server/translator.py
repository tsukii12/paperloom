"""OpenAI 兼容 API 批量翻译:块级 id 对齐、公式占位保护、JSON 校验、并发与取消。"""
from __future__ import annotations

import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

import httpx

from .converter.base import TRANSLATABLE, Block
from .settings import get_settings

_FORMULA_RE = re.compile(r"(\$[^$\n]{1,200}\$)")


class TransCancelled(Exception):
    """用户取消了翻译任务(已完成部分已保存)。"""

_SYSTEM = """你是一位资深学术论文译者。用户会提供一个 JSON 数组,每项形如 {{"id": "...", "text": "..."}}。
请将每项的 text 翻译为{lang},要求:
- 译文准确流畅,符合中文学术论文表达习惯;专业术语首次出现时可在括号内保留英文
- 保留 {{F0}}、{{F1}} 之类的公式占位符,原样放在译文中合适的位置,不要改写或翻译它们
- 不要翻译:LaTeX 命令、代码、URL、DOI、邮箱;引用标记如 [12]、(Smith et al., 2020) 中的编号按惯例保留
- 不要添加解释、注释或原文没有的内容

只输出一个 JSON 数组,格式为 [{{"id": "原id", "text": "译文"}}, ...],不要输出任何其他文字或代码块标记。"""


def _translatable_items(
    blocks: list[Block], only_missing: bool = True, only_ids: set[str] | None = None
) -> list[tuple[str, str]]:
    """展平需要翻译的文本单元:(item_id, 原文)。

    only_missing:跳过已有译文的块(增量续翻)。
    only_ids:只处理指定块(失败重试),此时忽略 only_missing。
    """
    items: list[tuple[str, str]] = []
    for b in blocks:
        if only_ids is not None and b.id not in only_ids:
            continue
        if b.type not in TRANSLATABLE:
            continue
        if only_missing and only_ids is None:
            if b.type in ("title", "text", "caption") and b.zh:
                continue
            if b.type == "list" and b.zh_items:
                continue
        if b.type in ("title", "text", "caption") and b.text and b.text.strip():
            items.append((b.id, b.text))
        elif b.type == "list":
            for i, t in enumerate(b.items or []):
                if t.strip():
                    items.append((f"{b.id}#i{i}", t))
    return items


def _protect_formulas(text: str) -> tuple[str, list[str]]:
    tokens: list[str] = []

    def _sub(m: re.Match) -> str:
        tok = f"{{{{F{len(tokens)}}}}}"
        tokens.append(m.group(0))
        return tok

    return _FORMULA_RE.sub(_sub, text), tokens


def _restore_formulas(text: str, tokens: list[str]) -> str:
    def _sub(m: re.Match) -> str:
        i = int(m.group(1))
        return tokens[i] if 0 <= i < len(tokens) else m.group(0)

    return re.sub(r"\{\{F(\d+)\}\}", _sub, text)


def _make_batches(
    items: list[tuple[str, str]], max_blocks: int, max_chars: int
) -> list[list[tuple[str, str]]]:
    batches: list[list[tuple[str, str]]] = []
    cur: list[tuple[str, str]] = []
    chars = 0
    for it in items:
        n = len(it[1])
        if cur and (len(cur) >= max_blocks or chars + n > max_chars):
            batches.append(cur)
            cur, chars = [], 0
        cur.append(it)
        chars += n
    if cur:
        batches.append(cur)
    return batches


def _parse_reply(content: str) -> dict[str, str]:
    """从模型回复中解析 {id: 译文}。容忍 ```json 围栏与多余文本。"""
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.S)
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        left, right = content.find("["), content.rfind("]")
        if left == -1 or right <= left:
            raise ValueError(f"回复不是 JSON 数组: {content[:200]}")
        data = json.loads(content[left : right + 1])
    out: dict[str, str] = {}
    for d in data:
        if isinstance(d, dict) and "id" in d and "text" in d:
            out[str(d["id"])] = str(d["text"])
    return out


def _call_llm(payload_items: list[tuple[str, str]], lang: str) -> dict[str, str]:
    s = get_settings()
    body: dict = {
        "model": s["model"],
        "temperature": s["temperature"],
        "messages": [
            {"role": "system", "content": _SYSTEM.format(lang=lang)},
            {"role": "user", "content": json.dumps(
                [{"id": i, "text": t} for i, t in payload_items], ensure_ascii=False)},
        ],
    }
    # 推理等级(文档翻译档):仅在与默认不同时发送,兼容不支持该参数的服务
    effort = str(s.get("reasoning_effort_doc") or "default")
    if effort != "default":
        body["reasoning_effort"] = effort
    resp = httpx.post(
        s["base_url"].rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {s['api_key']}"},
        json=body,
        timeout=300,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return _parse_reply(content)


def _backfill(blocks: list[Block], result_map: dict[str, str]) -> None:
    """把 result_map 中的译文写回对应块(可重复调用,增量合并)。"""
    for b in blocks:
        if b.type in ("title", "text", "caption"):
            if b.id in result_map:
                b.zh = result_map[b.id]
                b.error = None
        elif b.type == "list":
            zh_items = [(result_map.get(f"{b.id}#i{i}"), t) for i, t in enumerate(b.items or [])]
            if any(z is not None for z, _ in zh_items):
                b.zh_items = [z if z is not None else t for z, t in zh_items]


_SELECTION_SYSTEM = """你是资深学术翻译。把用户给出的文本准确翻译为{lang}:
- 符合中文学术表达,术语准确;首次出现的专业术语可在括号内保留英文
- 不要翻译公式、代码、URL、DOI;保留引用编号如 [12]
只输出译文本身,不要任何解释、前缀或代码块。"""


def translate_selection(text: str) -> str:
    """划词翻译:翻译一小段选中文本,返回译文。"""
    text = (text or "").strip()[:6000]
    if not text:
        return ""
    s = get_settings()
    body: dict = {
        "model": s["model"],
        "temperature": s["temperature"],
        "messages": [
            {"role": "system", "content": _SELECTION_SYSTEM.format(lang=s["target_lang"])},
            {"role": "user", "content": text},
        ],
    }
    effort = str(s.get("reasoning_effort_selection") or "default")
    if effort != "default":
        body["reasoning_effort"] = effort
    resp = httpx.post(
        s["base_url"].rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {s['api_key']}"},
        json=body,
        timeout=120,
    )
    resp.raise_for_status()
    return str(resp.json()["choices"][0]["message"]["content"]).strip()


def translate_blocks(
    blocks: list[Block],
    progress_cb: Callable[[float, str], None],
    persist: Callable[[], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    only_missing: bool = True,
    only_ids: set[str] | None = None,
) -> tuple[int, int]:
    """翻译可译文本,把译文回填进 blocks。返回 (成功单元数, 总单元数)。

    persist:每批完成后调用(增量落盘),中断不丢进度。
    cancel_check:批次边界轮询,返回 True 则中止(已译部分保留)。
    only_missing:增量模式,跳过已译块;only_ids:仅重译指定块。
    并发度与推理等级来自设置页。
    """
    items = _translatable_items(blocks, only_missing=only_missing, only_ids=only_ids)
    total = len(items)
    if total == 0:
        return 0, 0

    s = get_settings()
    lang = s["target_lang"]
    batches = _make_batches(items, s["batch_blocks"], s["batch_chars"])
    workers = max(1, int(s.get("concurrency") or 1))

    result_map: dict[str, str] = {}
    lock = threading.Lock()
    done = 0
    cancelled = False

    def _run_batch(batch: list[tuple[str, str]]) -> None:
        nonlocal cancelled, done
        if cancelled:
            return
        if cancel_check is not None and cancel_check():
            cancelled = True
            return
        # 占位保护后发送
        masked: list[tuple[str, str]] = []
        token_map: dict[str, list[str]] = {}
        for i, t in batch:
            mt, toks = _protect_formulas(t)
            token_map[i] = toks
            masked.append((i, mt))
        reply: dict[str, str] = {}
        try:
            reply = _call_llm(masked, lang)
        except Exception:
            reply = {}
        missing = {i for i, _ in batch if i not in reply}
        if missing and not (cancel_check and cancel_check()):
            retry_items = [(i, t) for i, t in masked if i in missing]
            try:
                reply.update(_call_llm(retry_items, lang))
            except Exception:
                pass
        with lock:
            for i, t in batch:
                if i in reply and reply[i].strip():
                    result_map[i] = _restore_formulas(reply[i], token_map[i])
            done += len(batch)
            progress_cb(done / total, f"翻译中 {done}/{total}")
            _backfill(blocks, result_map)  # 实时回填,前端轮询立即可见
            if persist is not None:
                persist()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_run_batch, b) for b in batches]
        for fut in as_completed(futures):
            fut.result()

    if cancelled:
        raise TransCancelled(f"已取消({done}/{total})")

    if persist is not None:
        persist()

    # 标记失败块(增量模式下已有译文的块不算失败)
    for b in blocks:
        if b.type in ("title", "text", "caption"):
            if (
                b.id not in result_map
                and not b.zh
                and b.type in TRANSLATABLE
                and b.text
                and b.text.strip()
            ):
                b.error = "翻译失败,请重试"
        elif b.type == "list":
            if not b.zh_items and any(t.strip() for t in (b.items or [])):
                b.error = "翻译失败,请重试"
    return len(result_map), total
