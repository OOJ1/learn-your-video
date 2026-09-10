"""文章处理流水线：解析 → 原文直存（不向量化）→ LLM 生成摘要。"""
from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.core.llm import LLMError, chat_json, get_llm
from app.services.parsers import extract_article_text
from app.services.store import DocStatus, get_store

SUMMARY_SYSTEM = (
    "你是「你的学习搭子」，一个擅长提炼知识的学习助手。"
    "请严格按用户要求的 JSON 结构输出，不要输出任何解释、不要使用 markdown 代码块。"
)

SUMMARY_TEMPLATE = """请阅读以下文章并产出学习总结。

【文章标题】{title}
【正文】
{content}

请输出如下 JSON（所有字段使用中文）：
{{
  "one_liner": "一句话摘要，不超过 60 字",
  "key_points": ["核心要点1", "核心要点2", "... 共 3-8 条，每条不超过 50 字"],
  "outline": ["文章结构/论述脉络1", "... 共 2-6 条"],
  "tags": ["标签1", "标签2", "... 共 2-5 个"],
  "reading_minutes": 预计阅读分钟数（整数）
}}
"""


def truncate_for_prompt(text: str, limit: int) -> tuple[str, bool]:
    """超长文章取首+尾，保证开头结论与结尾总结不丢失"""
    if len(text) <= limit:
        return text, False
    head = int(limit * 0.7)
    tail = limit - head
    return f"{text[:head]}\n\n……（正文省略）……\n\n{text[-tail:]}", True


def generate_summary(text: str, title: str) -> dict:
    s = get_settings()
    content, truncated = truncate_for_prompt(text, s.MAX_ARTICLE_CHARS)
    llm = get_llm()
    fallback = {
        "one_liner": "（摘要生成失败）",
        "key_points": [],
        "outline": [],
        "tags": [],
        "reading_minutes": 0,
        "_truncated": truncated,
    }
    try:
        data = chat_json(
            llm,
            [
                {"role": "system", "content": SUMMARY_SYSTEM},
                {"role": "user", "content": SUMMARY_TEMPLATE.format(title=title, content=content)},
            ],
            default=fallback,
        )
    except LLMError as e:
        data = dict(fallback)
        data["one_liner"] = f"（摘要生成失败：{e}）"
    data["_truncated"] = truncated
    data["_source_chars"] = len(text)
    return data


def process_article(doc_id: str, file_path: Path) -> None:
    """后台任务：解析原文 → 生成摘要。任何异常都落为 FAILED 而非崩溃。"""
    store = get_store()
    try:
        store.set_status(doc_id, DocStatus.PARSING, 15)
        text, meta = extract_article_text(file_path)

        store.set_text(doc_id, text)
        doc = store.get_doc(doc_id) or {}
        doc.update(meta)
        doc["chars"] = len(text)
        store.save_doc(doc)

        store.set_status(doc_id, DocStatus.SUMMARIZING, 55)
        summary = generate_summary(text, doc.get("filename", ""))

        doc = store.get_doc(doc_id) or {}
        doc["summary"] = summary
        store.save_doc(doc)
        store.set_status(doc_id, DocStatus.READY, 100)
    except Exception as e:
        # 先落状态再回读：否则会用过期副本覆盖掉刚写入的 FAILED
        store.set_status(doc_id, DocStatus.FAILED, 100, f"{type(e).__name__}: {e}")
        doc = store.get_doc(doc_id) or {}
        doc["error"] = str(e)
        store.save_doc(doc)


def to_markdown(doc: dict) -> str:
    s = doc.get("summary") or {}
    lines = [
        f"# {doc.get('filename', '未命名')} · 学习总结",
        "",
        f"> {s.get('one_liner', '（暂无摘要）')}",
        "",
    ]
    kp = s.get("key_points") or []
    if kp:
        lines += ["## 核心要点", ""]
        lines += [f"- {x}" for x in kp]
        lines.append("")
    ol = s.get("outline") or []
    if ol:
        lines += ["## 内容脉络", ""]
        lines += [f"{i}. {x}" for i, x in enumerate(ol, 1)]
        lines.append("")
    tags = s.get("tags") or []
    if tags:
        lines += ["## 标签", "", "  ".join(f"`{t}`" for t in tags), ""]
    if s.get("reading_minutes"):
        lines += [f"预计阅读时长：约 {s['reading_minutes']} 分钟", ""]
    if s.get("_truncated"):
        lines += ["> 注：原文过长，摘要基于截断后的内容生成。", ""]
    lines += ["---", "", f"由「你的学习搭子」自动生成 · 原文 {doc.get('chars', 0)} 字"]
    return "\n".join(lines)
