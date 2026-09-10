"""RAG 问答：文章走全文直投，视频走向量检索 + 时间戳；知识不足时触发联网搜索。"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from app.agents.search import SearchError, web_search
from app.config import get_settings
from app.core.llm import LLMError, chat_json, get_llm
from app.services.store import get_store
from app.services.vector import get_vector_store


@dataclass
class Ref:
    index: int
    kind: str          # article / video / web
    label: str
    doc_id: str | None = None
    start: float | None = None
    end: float | None = None
    url: str | None = None
    snippet: str = ""


class QAError(RuntimeError):
    pass


SYSTEM_PROMPT = (
    "你是「你的学习搭子」，一个基于用户上传资料回答问题的学习助手。\n"
    "规则：\n"
    "1. 优先且仅依据【参考资料】作答，不要凭空编造。\n"
    "2. 每个关键结论后必须紧跟来源编号，严格使用方括号格式，如 [1] 或 [2][3]；"
    "不要写成「资料 1」「來源編號 1」等其他形式。\n"
    "3. 资料确实没有涉及的内容，明确说明「资料中未提及」。\n"
    "4. 使用简体中文，适当用列表让答案结构化。"
)

ANSWER_TEMPLATE = """【参考资料】
{context}

【对话历史】
{history}

【问题】
{question}

请回答，并标注来源编号。"""


def fmt_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    h, r = divmod(int(sec), 3600)
    m, s = divmod(r, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:int(limit * 0.7)] + "\n\n……（省略）……\n\n" + text[-int(limit * 0.3):]


def build_local_context(doc_id: str, question: str) -> tuple[str, list[Ref]]:
    """文章：整篇直投（不向量化）；视频：向量检索 Top-K 并带回时间戳。"""
    s = get_settings()
    store = get_store()
    doc = store.get_doc(doc_id)
    if not doc:
        raise QAError("文档不存在")

    refs: list[Ref] = []
    blocks: list[str] = []

    if doc.get("type") == "article":
        text = store.get_text(doc_id)
        if not text:
            raise QAError("原文尚未解析完成")
        idx = 1
        blocks.append(f"【资料 {idx}｜来源：{doc.get('filename')}】\n{_truncate(text, s.MAX_ARTICLE_CHARS)}")
        refs.append(Ref(idx, "article", doc.get("filename", ""), doc_id=doc_id,
                        snippet=text[:120]))
    else:
        hits = get_vector_store().query(
            question, top_k=s.VIDEO_TOP_K, doc_id=doc_id, threshold=s.SCORE_THRESHOLD)
        if not hits:
            raise QAError("没有检索到相关内容（可能是相似度阈值过高，或字幕尚未生成）")
        for i, h in enumerate(hits, 1):
            m = h.get("metadata", {}) or {}
            st, en = float(m.get("start", 0.0)), float(m.get("end", 0.0))
            blocks.append(
                f"【资料 {i}｜来源：{doc.get('filename')} {fmt_time(st)}-{fmt_time(en)}"
                f"｜相似度 {h['score']}】\n{h['text']}"
            )
            refs.append(Ref(i, "video", f"{doc.get('filename')} {fmt_time(st)}",
                            doc_id=doc_id, start=st, end=en, snippet=h["text"][:120]))
    return "\n\n".join(blocks), refs


def decide_need_web(question: str, context: str) -> tuple[bool, str]:
    """让 LLM 判断本地资料是否足够回答"""
    s = get_settings()
    if (s.SEARCH_PROVIDER or "").lower() == "off":
        return False, "联网搜索已关闭"
    prompt = (
        "判断下面【参考资料】是否足以回答【问题】。\n"
        "只有在资料完全没涉及、或明显过时/不完整时才回答 insufficient。\n\n"
        f"【参考资料】\n{context[:4000]}\n\n【问题】\n{question}\n\n"
        '输出 JSON：{"sufficient": true 或 false, "reason": "一句话说明"}'
    )
    try:
        data = chat_json(get_llm(), [{"role": "user", "content": prompt}],
                         default={"sufficient": True, "reason": "判定失败，默认不联网"})
        return (not bool(data.get("sufficient", True))), str(data.get("reason", ""))
    except LLMError as e:
        return False, f"判定失败({e})，默认不联网"


def _history_text(doc_id: str, limit: int = 6) -> str:
    msgs = get_store().get_history(doc_id, limit=limit)
    if not msgs:
        return "（无）"
    return "\n".join(f"{'用户' if m['role'] == 'user' else '助手'}：{m['content'][:300]}"
                     for m in msgs)


def prepare(doc_id: str, question: str, use_web: str = "auto") -> tuple[list[dict], list[Ref], dict]:
    """检索 + 可选联网，产出最终 messages 与引用列表"""
    context, refs = build_local_context(doc_id, question)
    meta = {"used_web": False, "engine": None, "reason": "", "search_results": 0}

    # 配置里的 SEARCH_PROVIDER 是总开关：设为 off 时任何前端请求都不联网
    if (get_settings().SEARCH_PROVIDER or "").lower() == "off":
        need = False
        meta["reason"] = "联网搜索已关闭（可在右上角设置中心开启）"
    elif use_web == "on":
        need = True
    else:
        need, meta["reason"] = decide_need_web(question, context)

    if need:
        try:
            results, engine = web_search(question)
            meta.update(used_web=True, engine=engine, search_results=len(results))
            if results:
                base = len(refs)
                for i, r in enumerate(results, 1):
                    idx = base + i
                    snippet = (r.snippet or "")[:400]
                    context += f"\n\n【资料 {idx}｜网络：{r.title}】\n{snippet}"
                    refs.append(Ref(idx, "web", r.title or r.url, url=r.url, snippet=snippet))
        except SearchError as e:
            meta["search_error"] = str(e)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": ANSWER_TEMPLATE.format(
            context=context, history=_history_text(doc_id), question=question)},
    ]
    return messages, refs, meta


# LLM 的引用标注极不可控：[3]、"资料 3"、繁体"來源編號：**資料 3**" 都出现过。
# 中文分支允许「来源类词」与数字之间夹少量非数字字符（编号/冒号/加粗符等）。
_CITE = re.compile(r"\[(\d+)\]|(?:资料|資料|来源|來源)[^\d]{0,12}?(\d+)")


def _cited_ids(text: str) -> set[int]:
    out: set[int] = set()
    for m in _CITE.finditer(text):
        n = m.group(1) or m.group(2)
        if n:
            out.add(int(n))
    return out


def answer(doc_id: str, question: str, use_web: str = "auto") -> dict:
    messages, refs, meta = prepare(doc_id, question, use_web)
    text = get_llm().chat(messages)

    store = get_store()
    store.append_message(doc_id, "user", question)
    store.append_message(doc_id, "assistant", text, refs=[asdict(r) for r in refs])

    cited = _cited_ids(text)
    return {
        "ok": True,
        "answer": text,
        "refs": [asdict(r) | {"cited": r.index in cited} for r in refs],
        **meta,
    }


def stream_answer(doc_id: str, question: str, use_web: str = "auto"):
    """先产出 meta 事件，再逐 token 产出，最后产出引用。"""
    messages, refs, meta = prepare(doc_id, question, use_web)
    yield {"type": "meta", **meta}

    buf: list[str] = []
    for chunk in get_llm().stream(messages):
        buf.append(chunk)
        yield {"type": "delta", "text": chunk}

    text = "".join(buf)
    store = get_store()
    store.append_message(doc_id, "user", question)
    store.append_message(doc_id, "assistant", text, refs=[asdict(r) for r in refs])

    cited = _cited_ids(text)
    yield {"type": "done", "refs": [asdict(r) | {"cited": r.index in cited} for r in refs]}
