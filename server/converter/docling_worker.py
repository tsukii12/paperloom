"""Docling 转换子进程:逐页转换,每页写一次部分结果并报告进度。

用法: python docling_worker.py <pdf> <assets_dir> <out_json>
stdout 输出 PROG i/n 行供父进程解析;被 kill 时最多损失当前页。
自包含脚本(不 import server.*),可独立运行。
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def main() -> int:
    import truststore

    truststore.inject_into_ssl()  # 首次运行下载模型时兼容本机 TLS 拦截

    pdf = Path(sys.argv[1])
    assets = Path(sys.argv[2])
    out = Path(sys.argv[3])
    assets.mkdir(parents=True, exist_ok=True)

    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling_core.types.doc.document import (
        ListItem,
        PictureItem,
        SectionHeaderItem,
        TableItem,
    )

    # 注意导入顺序:docling(torch)之后才能安全加载 PDF 库,否则 Windows 上 DLL 冲突
    import pypdfium2 as _pdfium

    n_pages = len(_pdfium.PdfDocument(str(pdf)))

    print(f"MODEL 1/{n_pages}", flush=True)  # 首次运行需下载模型
    opts = PdfPipelineOptions()
    opts.do_ocr = False
    opts.do_table_structure = True
    opts.table_structure_options.do_cell_matching = True
    opts.generate_picture_images = True
    opts.images_scale = 2.0
    converter = DocumentConverter(
        format_options={"pdf": PdfFormatOption(pipeline_options=opts)}
    )

    def label_of(item) -> str:
        raw = getattr(item, "label", "")
        raw = getattr(raw, "value", raw)
        return str(raw or "").split(".")[-1].lower()

    skip = {"page_header", "page_footer", "page_number", "key_info"}
    blocks: list[dict] = []
    pending_list: list[str] = []
    img_i = 0

    def flush_list():
        nonlocal pending_list
        if pending_list:
            blocks.append({"type": "list", "items": pending_list, "page": page_no})
            pending_list = []

    for page_no in range(1, n_pages + 1):
        result = converter.convert(str(pdf), page_range=(page_no, page_no), raises_on_error=False)
        doc = result.document
        for item, _lvl in doc.iterate_items():
            try:
                if type(item).__name__ == "FormulaItem" or label_of(item) == "formula":
                    flush_list()
                    latex = (getattr(item, "text", "") or "").strip().strip("$").strip()
                    if latex:
                        blocks.append({"type": "equation", "latex": latex, "page": page_no})
                elif isinstance(item, SectionHeaderItem):
                    flush_list()
                    blocks.append(
                        {
                            "type": "title",
                            "text": (item.text or "").strip(),
                            "level": int(getattr(item, "level", 1) or 1),
                            "page": page_no,
                        }
                    )
                elif isinstance(item, TableItem):
                    flush_list()
                    grid = getattr(item.data, "grid", []) or []
                    cells = [[(c.text or "").strip() for c in row] for row in grid]
                    header_rows = 0
                    for row in grid[:2]:
                        if row and all(getattr(c, "column_header", False) for c in row):
                            header_rows += 1
                        else:
                            break
                    blocks.append(
                        {"type": "table", "cells": cells, "header_rows": header_rows, "page": page_no}
                    )
                elif isinstance(item, PictureItem):
                    flush_list()
                    img_i += 1
                    dest = assets / f"figure_{img_i:02d}.png"
                    saved = False
                    try:
                        doc.save_picture(item, str(dest), image_scale=2.0)
                        saved = dest.exists() and dest.stat().st_size > 0
                    except Exception:
                        saved = False
                    if not saved:
                        pil = getattr(getattr(item, "image", None), "pil_image", None)
                        if pil is not None:
                            pil.save(dest)
                            saved = True
                    if saved:
                        blocks.append({"type": "image", "img": f"assets/{dest.name}", "page": page_no})
                elif isinstance(item, ListItem):
                    txt = (getattr(item, "text", "") or "").strip()
                    if txt:
                        pending_list.append(txt)
                else:
                    label = label_of(item)
                    if label in skip:
                        continue
                    text = (getattr(item, "text", "") or "").strip()
                    if not text:
                        continue
                    flush_list()
                    if label == "caption":
                        blocks.append({"type": "caption", "text": text, "page": page_no})
                    elif label == "title":
                        blocks.append({"type": "title", "text": text, "level": 1, "page": page_no})
                    else:
                        blocks.append({"type": "text", "text": text, "page": page_no})
            except Exception:
                continue
        flush_list()
        out.write_text(
            json.dumps({"done": page_no, "n_pages": n_pages, "blocks": blocks}, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"PROG {page_no}/{n_pages}", flush=True)

    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
