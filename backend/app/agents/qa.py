"""RAG 问答：文章走全文直投，视频走向量检索 + 时间戳；知识不足时触发联网搜索。"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from app.agents.search import SearchError, web_search, web_search_status
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
    "1. 优先且仅依据【参考资料】作答，绝对不要凭空编造。\n"
    "2. 每个关键结论后必须紧跟来源编号，严格使用方括号格式，如 [1] 或 [2][3]；"
    "不要写成「资料 1」「來源編號 1」等其他形式。\n"
    "3. 资料确实没有涉及的内容，明确说明「资料中未提及」。\n"
    "4. 参考资料可能来自视频的「字幕」或「画面」，「画面」指屏幕/画面上呈现的文字与图表。\n"
    "5. 使用简体中文，适当用列表让答案结构化。"
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


def _article_hits(doc_id: str, question: str, doc: dict, flags: dict) -> list[dict]:
    """长文向量检索。阈值同样是软过滤：命中为空时退回最近邻，交给模型自己判断。

    与视频分支保持同一套策略——短视频/短文整篇只切出少数几块时相似度天然偏低，
    一问就报错会让这类资料完全没法提问。
    """
    s = get_settings()
    vs = get_vector_store()
    hits = vs.query(question, top_k=s.ARTICLE_TOP_K, doc_id=doc_id,
                    threshold=s.SCORE_THRESHOLD)
    if not hits:
        hits = vs.query(question, top_k=s.ARTICLE_TOP_K, doc_id=doc_id, threshold=-1.0)
        total = int(doc.get("chunks") or 0)
        flags["low_relevance"] = bool(hits) and total > s.ARTICLE_TOP_K
    if not hits:
        raise QAError("这篇文章还没有可检索的索引（可能向量化未完成），"
                      "请点右上角「重试」重新处理")
    return hits


def build_local_context(doc_id: str, question: str) -> tuple[str, list[Ref], dict]:
    """短文整篇直投、长文（已向量化）走 Top-K 检索；视频一律检索并带回时间戳。

    返回 (context, refs, flags)。flags["low_relevance"] 表示本地资料与问题相关度偏低。
    """
    s = get_settings()
    store = get_store()
    doc = store.get_doc(doc_id)
    if not doc:
        raise QAError("文档不存在")

    refs: list[Ref] = []
    blocks: list[str] = []
    flags = {"low_relevance": False}

    if doc.get("type") == "article" and doc.get("vectorized"):
        # 长文已切块入库：直投会撑爆上下文被截断、丢掉中间段落，检索反而更完整
        for i, h in enumerate(_article_hits(doc_id, question, doc, flags), 1):
            blocks.append(
                f"【资料 {i}｜来源：{doc.get('filename')}｜相似度 {h['score']}】\n{h['text']}"
            )
            refs.append(Ref(i, "article", doc.get("filename", ""), doc_id=doc_id,
                            snippet=h["text"][:120]))
    elif doc.get("type") == "article":
        text = store.get_text(doc_id)
        if not text:
            raise QAError("原文尚未解析完成")
        idx = 1
        blocks.append(f"【资料 {idx}｜来源：{doc.get('filename')}】\n{_truncate(text, s.MAX_ARTICLE_CHARS)}")
        refs.append(Ref(idx, "article", doc.get("filename", ""), doc_id=doc_id,
                        snippet=text[:120]))
    else:
        vs = get_vector_store()
        hits = vs.query(question, top_k=s.VIDEO_TOP_K, doc_id=doc_id,
                        threshold=s.SCORE_THRESHOLD)
        if not hits:
            # 阈值只能当软过滤，不能当硬闸门：短视频整段只切出 1 个块时相似度天然偏低，
            # 一问就 400 会让这类视频完全没法提问。退回最近邻，交给模型自己判断够不够。
            hits = vs.query(question, top_k=s.VIDEO_TOP_K, doc_id=doc_id, threshold=-1.0)
            # 内容本身就不超过 top_k 块时，回退等于把全文都交给模型了，
            # 相似度低不代表资料不可用，不必提示「相关度低」。
            total = int(doc.get("chunks") or 0)
            flags["low_relevance"] = bool(hits) and total > s.VIDEO_TOP_K
        if not hits:
            raise QAError("这个视频还没有可检索的字幕索引（可能转写或向量化未完成），"
                          "请点右上角「重试」重新处理")
        for i, h in enumerate(hits, 1):
            m = h.get("metadata", {}) or {}
            st, en = float(m.get("start", 0.0)), float(m.get("end", 0.0))
            # kind=visual 是画面识别结果：来源标为「画面」，只有单点时间戳
            is_visual = str(m.get("kind") or "") == "visual"
            tag = "画面" if is_visual else "字幕"
            span = fmt_time(st) if is_visual else f"{fmt_time(st)}-{fmt_time(en)}"
            blocks.append(
                f"【资料 {i}｜来源：{doc.get('filename')} {span}（{tag}）"
                f"｜相似度 {h['score']}】\n{h['text']}"
            )
            refs.append(Ref(i, "visual" if is_visual else "video",
                            f"{doc.get('filename')} {fmt_time(st)}",
                            doc_id=doc_id, start=st, end=en, snippet=h["text"][:120]))
    return "\n\n".join(blocks), refs, flags


def _clean_title(filename: str) -> str:
    """从内部文件名还原出可用作检索词的标题：去掉 v_xxxxxx_ 前缀与扩展名"""
    name = re.sub(r"^[A-Za-z]_[0-9a-fA-F]{8,}_", "", filename or "")
    name = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
    return name.replace("_", " ").strip()


def _search_query(doc_id: str, question: str) -> str:
    """联网检索词 = 资料标题 + 问题。

    问题里常有「这个视频」「他的观点」这类指代，单独拿去搜会搜偏，
    带上标题能显著提升相关性（不加 LLM 改写，避免多一次调用）。
    """
    doc = get_store().get_doc(doc_id) or {}
    title = _clean_title(str(doc.get("filename") or ""))
    return f"{title} {question}".strip() if title else question


def decide_need_web(question: str, context: str) -> tuple[bool, str]:
    """让 LLM 判断本地资料是否足够回答"""
    ok, why = web_search_status()
    if not ok:
        return False, why
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
    context, refs, flags = build_local_context(doc_id, question)
    meta = {"used_web": False, "engine": None, "reason": "", "search_results": 0, **flags}

    # 联网可用性由 web_search_status() 统一判定：设置关闭、或未配 Key 都算不可用。
    # 前端对应的开关此时也是锁死的（悬停会提示原因），这里再兜一层防止直连 API 绕过。
    web_ok, web_why = web_search_status()

    # 前端三档：off=仅本地（绝不联网）、on=强制联网、auto=由模型判断
    # 注意顺序——先判 use_web=="off"，否则会落进 auto 分支把「仅本地」当智能联网用
    if use_web == "off":
        need = False
        meta["reason"] = "已选择仅用本地资料"
    elif not web_ok:
        need = False
        meta["reason"] = web_why
    elif use_web == "on":
        need = True
    else:
        # 资料相关度偏低时明确提示判定模型，避免它硬拿低相关片段作答
        hint = "（注意：检索到的资料与问题相似度普遍偏低，很可能不足以回答。）" \
            if flags.get("low_relevance") else ""
        need, meta["reason"] = decide_need_web(question, context + hint)

    if need:
        try:
            results, engine = web_search(_search_query(doc_id, question))
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
