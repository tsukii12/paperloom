"""SQLite 文档元数据:状态流转 uploaded→converting→ready→translating→done/failed。

文件夹用「路径字符串」表示:'' 为根目录,'A/B/C' 为嵌套路径。docs.folder 与 folders.path
共用同一套路径语义,因此面包屑、层级跳转都不需要额外 JOIN。
"""
from __future__ import annotations

import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "paperloom.db"


@contextmanager
def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH), timeout=30)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with _conn() as c:
        # 首次升级到带 folders 表的版本:先留一份备份(项目非 git 仓库,无回滚手段)
        if _has_table(c, "docs") and not _has_table(c, "folders"):
            shutil.copy2(DB_PATH, DB_PATH.with_name(DB_PATH.name + ".bak"))
        c.execute(
            """CREATE TABLE IF NOT EXISTS docs(
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'uploaded',
                stage TEXT DEFAULT '',
                progress REAL DEFAULT 0,
                engine TEXT DEFAULT '',
                error TEXT DEFAULT '',
                n_pages INTEGER DEFAULT 0
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS annotations(
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                block_id TEXT NOT NULL,
                start INTEGER NOT NULL,
                end INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'highlight',
                color TEXT NOT NULL DEFAULT 'yellow',
                note TEXT DEFAULT '',
                side TEXT NOT NULL DEFAULT 'origin',
                created_at TEXT NOT NULL
            )"""
        )
        # 文件夹单独建表:文档隐含的路径之外,空文件夹也需要持久化
        c.execute(
            """CREATE TABLE IF NOT EXISTS folders(
                path TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            )"""
        )
        # 旧库迁移:补充 folder / tags / updated_at 列
        cols = {r[1] for r in c.execute("PRAGMA table_info(docs)").fetchall()}
        if "folder" not in cols:
            c.execute("ALTER TABLE docs ADD COLUMN folder TEXT DEFAULT ''")
        if "tags" not in cols:
            c.execute("ALTER TABLE docs ADD COLUMN tags TEXT DEFAULT '[]'")
        if "updated_at" not in cols:
            c.execute("ALTER TABLE docs ADD COLUMN updated_at TEXT DEFAULT ''")
            c.execute("UPDATE docs SET updated_at = created_at WHERE updated_at = ''")
        if "log" not in cols:
            c.execute("ALTER TABLE docs ADD COLUMN log TEXT DEFAULT ''")
        ann_cols = {r[1] for r in c.execute("PRAGMA table_info(annotations)").fetchall()}
        if "side" not in ann_cols:
            c.execute("ALTER TABLE annotations ADD COLUMN side TEXT NOT NULL DEFAULT 'origin'")


def _has_table(c: sqlite3.Connection, name: str) -> bool:
    return c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def add_annotation(ann_id: str, doc_id: str, block_id: str, start: int, end: int,
                   kind: str, color: str, note: str, side: str = "origin") -> dict:
    import datetime

    with _conn() as c:
        c.execute(
            "INSERT INTO annotations(id, doc_id, block_id, start, end, kind, color, note, side, created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (ann_id, doc_id, block_id, start, end, kind, color, note, side,
             datetime.datetime.now().isoformat(timespec="seconds")),
        )
    return {
        "id": ann_id, "doc_id": doc_id, "block_id": block_id, "start": start, "end": end,
        "kind": kind, "color": color, "note": note, "side": side,
    }


def list_annotations(doc_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM annotations WHERE doc_id=? ORDER BY created_at", (doc_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def update_annotation(doc_id: str, ann_id: str, **fields) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE annotations SET {cols} WHERE id=? AND doc_id=?",
                  (*fields.values(), ann_id, doc_id))


def delete_annotation(doc_id: str, ann_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM annotations WHERE id=? AND doc_id=?", (ann_id, doc_id))


def create_doc(doc_id: str, filename: str) -> None:
    import datetime

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as c:
        c.execute(
            "INSERT INTO docs(id, filename, created_at, updated_at) VALUES(?,?,?,?)",
            (doc_id, filename, now, now),
        )


def update_doc(doc_id: str, **fields) -> None:
    """更新文档字段,并自动刷新 updated_at(不带字段调用即为「标记已修改」)。"""
    import datetime

    fields.setdefault("updated_at", datetime.datetime.now().isoformat(timespec="seconds"))
    cols = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        c.execute(f"UPDATE docs SET {cols} WHERE id=?", (*fields.values(), doc_id))


def touch_doc(doc_id: str) -> None:
    """只刷新修改时间:批注等不经过 docs 表的操作,也要体现为「文档有改动」。"""
    update_doc(doc_id)


MAX_LOG = 8000


def append_log(doc_id: str, line: str) -> None:
    """给文档追加一行处理日志(转换/翻译的进度明细,供界面上点状态查看)。"""
    import datetime

    stamp = datetime.datetime.now().strftime("%H:%M:%S")
    entry = f"[{stamp}] {line.strip()}\n"
    with _conn() as c:
        row = c.execute("SELECT log FROM docs WHERE id=?", (doc_id,)).fetchone()
        if row is None:
            return
        merged = (row[0] or "") + entry
        if len(merged) > MAX_LOG:
            merged = merged[-MAX_LOG:]
        c.execute("UPDATE docs SET log=? WHERE id=?", (merged, doc_id))


def clear_log(doc_id: str) -> None:
    with _conn() as c:
        c.execute("UPDATE docs SET log='' WHERE id=?", (doc_id,))


def get_doc(doc_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM docs WHERE id=?", (doc_id,)).fetchone()
        return dict(row) if row else None


def list_docs() -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM docs ORDER BY created_at DESC, id DESC").fetchall()
        return [dict(r) for r in rows]


def delete_doc(doc_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM docs WHERE id=?", (doc_id,))


# ---------------- 文件夹 ----------------

def list_folders() -> list[str]:
    with _conn() as c:
        return [r[0] for r in c.execute("SELECT path FROM folders ORDER BY path")]


def folder_exists(path: str) -> bool:
    with _conn() as c:
        return c.execute("SELECT 1 FROM folders WHERE path=?", (path,)).fetchone() is not None


def create_folder(path: str) -> bool:
    """新建文件夹并逐级补齐祖先。返回 False 表示该文件夹已存在。"""
    import datetime

    now = datetime.datetime.now().isoformat(timespec="seconds")
    parts = path.split("/")
    with _conn() as c:
        exists = c.execute("SELECT 1 FROM folders WHERE path=?", (path,)).fetchone() is not None
        for i in range(1, len(parts) + 1):
            c.execute(
                "INSERT OR IGNORE INTO folders(path, created_at) VALUES(?, ?)",
                ("/".join(parts[:i]), now),
            )
        return not exists


def ensure_folders(path: str) -> None:
    """确保文档归位的目标路径及其祖先都存在于 folders 表。"""
    if path:
        create_folder(path)


def rename_prefix(old: str, new: str) -> None:
    """把 old 及其整棵子树重写到 new 下(重命名文件夹与「删除=折叠进上一级」共用)。

    前缀比较用 substr() 而不是 LIKE:SQLite 的 LIKE 对 ASCII 大小写不敏感,
    且会把文件夹名里的 % _ 当作通配符。

    new 为空(折叠到根目录)时要单独处理,否则 '' || '/子目录' 会拼出前导斜杠。
    """
    import datetime

    prefix = old + "/"  # 用于精确匹配子路径
    cut = len(old) + 1  # substr 从 1 起算:取到的后缀带前导 '/'
    cut_deep = len(old) + 2  # 跳过 '/',用于拼到空路径后面的情况
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as c:
        c.execute(
            "UPDATE docs SET folder = CASE WHEN ? = '' THEN substr(folder, ?)"
            " ELSE ? || substr(folder, ?) END, updated_at = ?"
            " WHERE folder = ? OR substr(folder, 1, ?) = ?",
            (new, cut_deep, new, cut, now, old, len(prefix), prefix),
        )
        # folders 表不能原地 UPDATE:删除文件夹时 old 会塌缩成 new,撞主键
        affected = [
            r[0]
            for r in c.execute(
                "SELECT path FROM folders WHERE path = ? OR substr(path, 1, ?) = ?",
                (old, len(prefix), prefix),
            ).fetchall()
        ]
        c.executemany("DELETE FROM folders WHERE path = ?", [(p,) for p in affected])
        for p in affected:
            rel = "" if p == old else p[len(old) + 1:]
            np = f"{new}/{rel}" if new and rel else (new or rel)
            if np:
                c.execute(
                    "INSERT OR IGNORE INTO folders(path, created_at) VALUES(?, ?)", (np, now)
                )


def move_docs(ids: list[str], to: str) -> int:
    """批量移动文档到目标文件夹(单事务)。返回实际移动的篇数。"""
    import datetime

    if not ids:
        return 0
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as c:
        cur = c.executemany(
            "UPDATE docs SET folder=?, updated_at=? WHERE id=?", [(to, now, i) for i in ids]
        )
        return cur.rowcount
