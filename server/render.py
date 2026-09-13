"""blocks → 独立 HTML 文件(原文/译文/双栏)。

表格、图片、公式均在各自的阅读顺序位置内联渲染,版式与 Reader 一致。
"""
from __future__ import annotations

import html
from pathlib import Path

from .converter.base import Block, load_blocks

_CSS = """
:root { --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --accent:#4f46e5; }
* { box-sizing: border-box; }
body { margin:0; padding:40px 16px 80px; background:#fafafa; color:var(--ink);
  font:15px/1.75 ui-sans-serif,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
.wrap { max-width:1180px; margin:0 auto; }
h1.doc-title { font-size:22px; margin:0 0 6px; }
.doc-sub { color:var(--muted); font-size:13px; margin-bottom:28px; }
.dual { display:grid; grid-template-columns:1fr 1fr; gap:0 36px; align-items:stretch; }
.dual > .cell { min-width:0; }
.colhead { font-size:12px; letter-spacing:.08em; color:var(--muted); text-transform:uppercase;
  border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:14px; }
h2.blk { font-size:20px; margin:26px 0 10px; line-height:1.4; }
h3.blk { font-size:17px; margin:22px 0 8px; }
p.blk { margin:0 0 14px; text-align:justify; }
.cap { font-size:12.5px; color:var(--muted); text-align:center; margin:4px 0 16px; }
figure { margin:0 0 18px; text-align:center; }
figure img { max-width:100%; height:auto; border:1px solid var(--line); border-radius:6px; padding:6px; background:#fff; }
table.blk { border-collapse:collapse; margin:0 0 18px; width:100%; font-size:13.5px; background:#fff; }
table.blk th, table.blk td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
table.blk th { background:#f5f6fa; font-weight:600; }
.eq { overflow-x:auto; margin:0 0 16px; padding:6px 2px; }
ul.blk { margin:0 0 14px; padding-left:1.4em; }
ul.blk li { margin-bottom:4px; }
.muted { color:var(--muted); }
"""

_SCRIPT = """
<script>
window.MathJax = { tex: { inlineMath: [['\\\\(','\\\\)']], displayMath: [['$$','$$']] },
  options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'] } };
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
"""


def _esc(t: str) -> str:
    return html.escape(t or "", quote=False)


def _block_html(b: Block, zh: bool) -> str:
    """单个块 → HTML 片段。zh=True 时用译文(缺失则显示占位)。"""
    t = b.type
    if t == "title":
        text = b.zh if (zh and b.zh) else b.text
        lvl = min(max(b.level or 2, 2), 3)
        if zh and not b.zh:
            return '<p class="blk muted">— 待翻译 —</p>'
        return f"<h{lvl} class='blk'>{_esc(text)}</h{lvl}>"
    if t in ("text", "caption"):
        text = b.zh if (zh and b.zh is not None) else b.text
        if zh and not b.zh:
            return '<p class="blk muted">— 待翻译 —</p>'
        if t == "caption":
            return f"<p class='cap'>{_esc(text)}</p>"
        return f"<p class='blk'>{_esc(text)}</p>"
    if t == "list":
        items = b.zh_items if (zh and b.zh_items) else b.items
        lis = "".join(f"<li>{_esc(x)}</li>" for x in (items or []))
        return f"<ul class='blk'>{lis}</ul>"
    if t == "table":
        cells = b.cells or []  # 表格不翻译,始终展示原文
        if not cells:
            return ""
        head = ""
        hr = b.header_rows if cells else 0
        if hr and len(cells) > hr:
            thead = "".join(f"<th>{_esc(c)}</th>" for c in cells[0])
            body_rows = cells[hr:]
            head = f"<thead><tr>{thead}</tr></thead>"
        else:
            body_rows = cells
        rows = "".join(
            "<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in r) + "</tr>" for r in body_rows
        )
        return f"<table class='blk'>{head}<tbody>{rows}</tbody></table>"
    if t == "image":
        if not b.img:
            return ""
        src = _esc(b.img)
        return f"<figure><img src='{src}' loading='lazy' alt='figure'></figure>"
    if t == "equation":
        return f"<div class='eq'>$${_esc(b.latex or '')}$$</div>"
    return ""


def render_standalone(doc_dir: Path, variant: str, title: str) -> Path:
    """生成独立 HTML:variant ∈ origin | translated | dual。返回文件路径。"""
    _engine, blocks = load_blocks(doc_dir)
    body: list[str] = []

    if variant == "dual":
        body.append("<div class='wrap'>")
        body.append(f"<h1 class='doc-title'>{_esc(title)}</h1>")
        body.append("<p class='doc-sub'>PaperLoom 双栏对照 · 原文 / 译文</p>")
        # 每个块一行:左右单元格同行渲染,行高取两侧较大者,保证上下对齐
        body.append("<div class='dual'><div class='colhead'>原文 · Original</div>"
                    "<div class='colhead'>译文 · Translation</div>")
        for b in blocks:
            body.append(
                f"<div class='cell'>{_block_html(b, zh=False)}</div>"
                f"<div class='cell'>{_block_html(b, zh=True)}</div>"
            )
        body.append("</div></div>")
    else:
        zh = variant == "translated"
        body.append("<div class='wrap' style='max-width:860px'>")
        body.append(f"<h1 class='doc-title'>{_esc(title)}</h1>")
        body.append(
            f"<p class='doc-sub'>PaperLoom · {'译文' if zh else '原文'}</p>"
        )
        for b in blocks:
            body.append(_block_html(b, zh=zh))
        body.append("</div>")

    out = doc_dir / f"{variant}.html"
    out.write_text(
        "<!doctype html><html lang='zh'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{_esc(title)} · PaperLoom</title>"
        f"<style>{_CSS}</style></head><body>"
        + "".join(body)
        + _SCRIPT
        + "</body></html>",
        encoding="utf-8",
    )
    return out
