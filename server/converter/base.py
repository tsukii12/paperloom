"""Block 统一模型与转换引擎接口。

所有引擎(docling / mineru)的输出都归一化为按阅读顺序排列的 Block 列表,
原文/译文 HTML 均由 render.py 从该列表生成——图片、表格在其阅读位置内联,
保证上下位置关系和格式不乱。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict, fields
from pathlib import Path
from typing import Callable, Literal, Optional

BlockType = Literal["title", "text", "table", "image", "equation", "caption", "list"]

# 需要翻译的块类型(equation/image 保持原样)
TRANSLATABLE = {"title", "text", "caption", "list"}  # 表格/图片/公式不翻译

ProgressFn = Callable[[str, float], None]  # (stage 文案, 0..1)


class ConversionError(Exception):
    pass


class ConversionCancelled(Exception):
    """用户取消转换(由 jobs 层捕获并更新状态)。"""


@dataclass
class Block:
    id: str = ""
    type: BlockType = "text"
    page: int = 0
    text: Optional[str] = None          # title / text / caption 的原文
    level: Optional[int] = None         # title 层级 1..4
    items: Optional[list] = None        # list 条目
    cells: Optional[list] = None        # table 二维单元格
    header_rows: int = 0                # table 表头行数
    latex: Optional[str] = None         # equation
    img: Optional[str] = None           # image,相对 doc 目录路径 assets/xxx.jpg
    # —— 译文(翻译后回填)——
    zh: Optional[str] = None
    zh_items: Optional[list] = None
    zh_cells: Optional[list] = None
    # 翻译失败原因(块级)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "Block":
        names = {f.name for f in fields(Block)}
        return Block(**{k: v for k, v in d.items() if k in names})


def finalize(blocks: list[Block]) -> list[Block]:
    """按顺序分配块 id,去掉完全空白的块。"""
    out = []
    i = 0
    for b in blocks:
        if b.type in ("title", "text", "caption") and not (b.text or "").strip():
            continue
        if b.type == "list" and not [t for t in (b.items or []) if t.strip()]:
            continue
        if b.type == "table" and not b.cells:
            continue
        if b.type == "equation" and not (b.latex or "").strip():
            continue
        b.id = f"b{i:04d}"
        i += 1
        out.append(b)
    return out


def save_blocks(doc_dir: Path, engine: str, blocks: list[Block]) -> None:
    data = {
        "engine": engine,
        "blocks": [b.to_dict() for b in blocks],
    }
    (doc_dir / "blocks.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def load_blocks(doc_dir: Path) -> tuple[str, list[Block]]:
    f = doc_dir / "blocks.json"
    if not f.exists():
        raise FileNotFoundError("尚未转换:缺少 blocks.json")
    data = json.loads(f.read_text(encoding="utf-8"))
    return data.get("engine", ""), [Block.from_dict(d) for d in data.get("blocks", [])]


def convert_pdf(
    engine: str,
    pdf_path: Path,
    doc_dir: Path,
    progress: ProgressFn,
    cancel_check: Callable[[], bool] | None = None,
) -> list[Block]:
    """引擎统一入口。图片等资产写入 doc_dir/assets/,返回按阅读顺序的 Block 列表。"""
    if engine == "docling":
        from .docling_backend import convert as run
    elif engine == "mineru":
        from .mineru_backend import convert as run
    else:
        raise ConversionError(f"未知转换引擎: {engine}")
    raw = run(pdf_path, doc_dir, progress, cancel_check=cancel_check)
    blocks = finalize(raw if raw and isinstance(raw[0], Block) else [Block(**d) for d in raw])
    if not blocks:
        raise ConversionError("未解析到任何内容块:该 PDF 可能是扫描件,或引擎解析失败")
    n_pages = max((b.page for b in blocks), default=0)
    (doc_dir / "_pages.txt").write_text(str(n_pages), encoding="utf-8")
    return blocks
