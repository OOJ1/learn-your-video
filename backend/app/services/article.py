"""文章处理流水线：解析 → 原文直存（不向量化）→ LLM 生成摘要。"""
from __future__ import annotations

from pathlib import Path

from app.config import get_settings
from app.core.llm import LLMError, chat_json, get_llm
from app.core.schema import normalize_notes, normalize_text
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
  "key_points": ["核心要点1", "核心要点2", "... 共 3-6 条，每条不超过 50 字"],
  "review": "你对这篇文章的评价与看法，120-250 字。要有明确观点：论证是否站得住、亮点与不足在哪、值不值得读、适合谁读；不要复述内容，也不要说空话。",
  "notes": [
    {{"title": "笔记小节标题（如：核心论点 / 关键论据 / 方法步骤 / 值得记的结论）",
      "points": ["这一节的知识点1", "知识点2"]}},
    "... 共 2-4 个小节，每节 2-4 条"
  ],
  "tags": ["标签1", "标签2", "... 共 2-5 个"],
  "reading_minutes": 预计阅读分钟数（整数）
}}

要求：
- notes 要整理成「能直接当复习笔记用」的知识条目：自己归纳、重组成体系，不要照抄原文句子；可以补充必要的背景、因果与推论。每条 points 请写成完整的一句话，不要只写关键词。
- review 是评价而非总结：要敢于指出不足（如论据薄弱、观点陈旧、夹带营销、结论跳跃），也要说明亮点。若文章确实平庸，直接说平庸，不要刻意恭维。
- review 写成一段连续的文字，不要手动换行（换行会破坏 JSON）。
- 文本中禁止使用英文双引号 \"，否则会破坏 JSON 格式（引用词语请用「」）。
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
    # 按 SUMMARY_INPUT_CHARS 留出输出空间：提示词吃满上下文会导致 JSON 被硬截断
    content, truncated = truncate_for_prompt(text, s.SUMMARY_INPUT_CHARS)
    llm = get_llm()
    fallback = {
        "one_liner": "（摘要生成失败）",
        "key_points": [],
        "review": "",
        "notes": [],
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
            max_tokens=s.SUMMARY_MAX_TOKENS,
        )
    except LLMError as e:
        data = dict(fallback)
        data["one_liner"] = f"（摘要生成失败：{e}）"
    normalize_text(data, "review", 1200)
    normalize_notes(data)
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


def _mmss(sec) -> str:
    try:
        sec = max(0, int(float(sec)))
    except (TypeError, ValueError):
        return "0:00"
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def _point_text(x) -> str:
    """要点兼容 {'t':.., 'text':..} 与纯字符串两种形态。

    全片时间轴下线后，时间戳改由核心要点承载，导出时一并带上，
    这样 Markdown 里的要点也能对应回视频位置。
    """
    if isinstance(x, dict):
        text = str(x.get("text", ""))
        t = x.get("t")
        if t is not None:
            return f"`{_mmss(t)}` {text}"
        return text
    return str(x)


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
        lines += [f"- {_point_text(x)}" for x in kp]
        lines.append("")

    review = s.get("review")
    if review:
        lines += ["## 模型评价", "", str(review), ""]

    notes = s.get("notes") or []
    if notes:
        lines += ["## 知识笔记", ""]
        for n in notes:
            title = (n.get("title") or "").strip() if isinstance(n, dict) else ""
            if title:
                lines += [f"### {title}", ""]
            pts = (n.get("points") or []) if isinstance(n, dict) else [n]
            lines += [f"- {p}" for p in pts]
            lines.append("")

    # 旧版摘要（内容脉络）兜底，避免历史记录导出后内容为空
    ol = s.get("outline") or []
    if ol and not notes:
        lines += ["## 内容脉络", ""]
        lines += [f"{i}. {_point_text(x)}" for i, x in enumerate(ol, 1)]
        lines.append("")

    vs = s.get("value_score") or {}
    if vs.get("total") is not None:
        lines += [f"## 含金量评分：{vs.get('total')}/100（{vs.get('level', '')}）", ""]
        if vs.get("verdict"):
            lines += [f"{vs['verdict']}", ""]
        for d in (vs.get("dimensions") or {}).values():
            lines.append(f"- {d.get('label', '')}：{d.get('score', 0)}/20 {d.get('reason', '')}")
        if vs.get("watch_advice"):
            lines += ["", f"观看建议：{vs['watch_advice']}"]
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
