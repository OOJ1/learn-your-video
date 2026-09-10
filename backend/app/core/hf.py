"""HuggingFace 下载环境统一配置（国内网络 + Windows 符号链接问题）。"""
from __future__ import annotations

import os

from app.config import get_settings


def ensure_hf_env() -> None:
    s = get_settings()
    # Windows 未开开发者模式时 HF 符号链接失效（快照 0 字节），改为直接复制
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    # xet 存储在国内网络下易 401，回退传统 HTTP
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if s.HF_ENDPOINT:
        os.environ.setdefault("HF_ENDPOINT", s.HF_ENDPOINT)
