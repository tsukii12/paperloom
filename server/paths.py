"""PaperLoom 可写数据路径。

程序资源目录只读；数据库、文档、引擎和设置统一放到用户可写目录。
数据目录位置由 LOCALAPPDATA/PaperLoom/data-location.json 持久化，也可用
PAPERLOOM_DATA_DIR 环境变量覆盖（桌面启动器使用）。
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent


def _user_root() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "PaperLoom"


USER_ROOT = _user_root()
LOCATION_FILE = Path(os.path.abspath(
    os.environ.get("PAPERLOOM_LOCATION_FILE") or (USER_ROOT / "data-location.json")
))
DEFAULT_DATA_DIR = USER_ROOT / "data"
LEGACY_DATA_DIR = Path(os.path.abspath(
    os.environ.get("PAPERLOOM_LEGACY_DATA_DIR") or (APP_ROOT / "data")
))


def _normalize(raw: str | os.PathLike[str]) -> Path:
    value = os.path.expandvars(os.path.expanduser(str(raw).strip().strip('"')))
    # Windows 从 MSIX/沙箱宿主启动子进程时，Path.resolve() 可能把正常的
    # LOCALAPPDATA 路径改写到 Packages/.../LocalCache。这里仅做词法绝对化。
    return Path(os.path.abspath(value))


def _configured_data_dir() -> Path:
    override = os.environ.get("PAPERLOOM_DATA_DIR", "").strip()
    if override:
        return _normalize(override)
    try:
        saved = json.loads(LOCATION_FILE.read_text(encoding="utf-8"))
        if saved.get("data_dir"):
            return _normalize(saved["data_dir"])
    except (OSError, ValueError, TypeError):
        pass
    return Path(os.path.abspath(DEFAULT_DATA_DIR))


DATA_DIR = _configured_data_dir()
DOCS_DIR = DATA_DIR / "docs"
TRASH_DIR = DATA_DIR / "trash"
ENGINES_DIR = DATA_DIR / "engines"
DB_PATH = DATA_DIR / "paperloom.db"
SETTINGS_PATH = DATA_DIR / "settings.json"


def ensure_data_dir() -> bool:
    """建立数据目录，并在目标尚无有效数据时复制旧版目录。返回是否发生迁移。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATA_DIR == LEGACY_DATA_DIR or not LEGACY_DATA_DIR.is_dir():
        return False
    meaningful = [p for p in DATA_DIR.iterdir() if p.name != "backend.log"]
    legacy_items = list(LEGACY_DATA_DIR.iterdir())
    if meaningful or not legacy_items:
        return False
    shutil.copytree(LEGACY_DATA_DIR, DATA_DIR, dirs_exist_ok=True)
    return True


def save_data_location(path: Path) -> None:
    USER_ROOT.mkdir(parents=True, exist_ok=True)
    tmp = LOCATION_FILE.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"data_dir": str(path)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(LOCATION_FILE)


def normalize_data_dir(raw: object) -> Path:
    text = str(raw or "").strip()
    if not text:
        raise ValueError("数据目录不能为空")
    path = _normalize(text)
    if not path.is_absolute() or path.parent == path:
        raise ValueError("请选择具体的数据目录，不能使用磁盘根目录")
    return path
