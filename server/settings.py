"""LLM API 设置:data/settings.json 持久化。"""
from __future__ import annotations

import json
import threading
from .paths import SETTINGS_PATH

_PATH = SETTINGS_PATH
_LOCK = threading.Lock()

DEFAULTS = {
    "base_url": "https://api.openai.com/v1",
    "api_key": "",
    "model": "gpt-4o-mini",
    "target_lang": "简体中文",
    "batch_blocks": 16,      # 每次请求翻译的块数
    "batch_chars": 4000,     # 每次请求的字符上限
    "temperature": 0.2,
    "concurrency": 4,        # 翻译请求并发数
    "reasoning_effort_doc": "default",       # 文档翻译推理等级
    "reasoning_effort_selection": "default", # 划词翻译推理等级
    "engine": "docling",     # 默认转换引擎
    # 解析模型的下载源(huggingface 系):hf-mirror(国内镜像) | modelscope | huggingface。
    # MinerU 三个都认;Docling 只走 HuggingFace,选 modelscope 时按 huggingface 处理。
    "model_source": "hf-mirror",
    # 引擎包(含 torch)从 PyPI 下载:tsinghua | aliyun | ustc | tencent | ''(官方) | 自定义 URL
    "pypi_index": "tsinghua",
}

_EFFORTS = ("default", "minimal", "low", "medium", "high")
_MODEL_SOURCES = ("hf-mirror", "modelscope", "huggingface")


def get_settings() -> dict:
    data = dict(DEFAULTS)
    if _PATH.exists():
        try:
            saved = json.loads(_PATH.read_text(encoding="utf-8"))
        except Exception:
            saved = {}
        # 旧版本把 docling / mineru 的模型源分开存,合并成一个 model_source。
        # 值等于旧默认(huggingface)的不带过来 —— 那是没人改过的残留,
        # 否则换成国内镜像的默认值以后永远生效不了。
        m1 = saved.pop("mineru_model_source", None)
        m2 = saved.pop("docling_model_source", None)
        legacy = next((v for v in (m1, m2) if v and v != "huggingface"), None)
        if "model_source" not in saved and legacy:
            saved["model_source"] = legacy
        data.update(saved)
    return data


def save_settings(patch: dict) -> dict:
    with _LOCK:
        data = get_settings()
        for k in DEFAULTS:
            if k in patch and patch[k] is not None:
                data[k] = patch[k]
        # 基础类型修正
        data["batch_blocks"] = max(1, int(data["batch_blocks"]))
        data["batch_chars"] = max(500, int(data["batch_chars"]))
        data["temperature"] = min(1.0, max(0.0, float(data["temperature"])))
        data["concurrency"] = min(16, max(1, int(data["concurrency"])))
        # 兼容旧字段 reasoning_effort → 拆分到文档/划词两档
        legacy = data.pop("reasoning_effort", None)
        for k in ("reasoning_effort_doc", "reasoning_effort_selection"):
            if data.get(k) not in _EFFORTS:
                data[k] = legacy if legacy in _EFFORTS else "default"
        if data["engine"] not in ("docling", "mineru"):
            data["engine"] = "docling"
        if data["model_source"] not in _MODEL_SOURCES:
            data["model_source"] = "hf-mirror"
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data
