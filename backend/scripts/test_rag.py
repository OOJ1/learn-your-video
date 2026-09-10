"""不依赖 LLM 的检索/联网自检：验证上下文构建、时间戳引用、搜索引擎。

用法: python scripts/test_rag.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.qa import build_local_context, fmt_time  # noqa: E402
from app.agents.search import web_search  # noqa: E402
from app.services.store import get_store, make_doc  # noqa: E402
from app.services.vector import get_vector_store  # noqa: E402
from app.config import get_settings  # noqa: E402


def test_article():
    store = get_store()
    doc = make_doc("RAG综述.md", "article")
    store.save_doc(doc)
    store.set_text(doc["id"], "检索增强生成（RAG）通过先检索再生成来缓解大模型幻觉问题。" * 20)
    ctx, refs = build_local_context(doc["id"], "RAG 如何缓解幻觉？")
    print(f"[文章] 上下文 {len(ctx)} 字, 引用 {len(refs)} 条 -> {refs[0].kind}/{refs[0].label}")
    assert refs[0].kind == "article"
    return doc["id"]


def test_video():
    """复用 ChromaDB 里已有向量的 doc_id"""
    vs = get_vector_store()
    got = vs._col.get(include=["metadatas"])
    doc_ids = {m.get("doc_id") for m in (got.get("metadatas") or []) if m.get("doc_id")}
    if not doc_ids:
        print("[视频] ChromaDB 为空，跳过（先上传一个视频）")
        return None

    doc_id = sorted(doc_ids)[0]
    store = get_store()
    if not store.get_doc(doc_id):
        d = make_doc("test_video.mp4", "video")
        d["id"] = doc_id
        store.save_doc(d)

    ctx, refs = build_local_context(doc_id, "怎么减少幻觉？")
    print(f"[视频] 上下文 {len(ctx)} 字, 引用 {len(refs)} 条")
    for r in refs:
        print(f"       [{r.index}] {r.kind}  {fmt_time(r.start or 0)}-{fmt_time(r.end or 0)}  {r.snippet[:40]}")
    assert all(r.start is not None for r in refs), "视频引用必须带时间戳"
    return doc_id


def test_search():
    s = get_settings()
    print(f"[搜索] provider={s.SEARCH_PROVIDER}  tavily_key={'已配置' if s.TAVILY_API_KEY else '未配置'}")
    try:
        results, engine = web_search("检索增强生成 RAG 技术", max_results=3)
        print(f"[搜索] 引擎={engine}, 结果 {len(results)} 条")
        for r in results[:3]:
            print(f"       - {r.title[:50]} | {r.url[:60]}")
    except Exception as e:
        print(f"[搜索] 失败: {type(e).__name__}: {e}")


if __name__ == "__main__":
    print("=== RAG / 搜索自检（不需要 LLM）===")
    test_article()
    test_video()
    test_search()
