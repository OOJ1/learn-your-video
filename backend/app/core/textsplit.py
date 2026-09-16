"""纯文本切块：给文章这类「无时间戳」的长文本用。

视频字幕的切块在 services/video.py（它要把每块映射回时间戳，逻辑不同），
这里只负责把文本按语义边界切成等长块，供向量化使用。
"""
from __future__ import annotations

# 中文语料的分隔优先级：段落 → 换行 → 句末标点 → 分句标点 → 空格 → 硬切
_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]


def split_plain_text(text: str, chunk_size: int = 500, overlap: int = 80) -> list[str]:
    """递归字符切块，返回非空块列表。

    RecursiveCharacterTextSplitter 会优先在 separators 靠前的边界处断开，
    尽量避免把一句话从中间劈开；chunk_overlap 让相邻块共享一小段上下文，
    减少「答案正好被切在边界上」的检索丢失。
    """
    if not text or not text.strip():
        return []
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        separators=_SEPARATORS,
    )
    return [c for c in splitter.split_text(text) if c.strip()]
