"""用假搜索结果验证「联网增强」链路是否通（无需 Tavily Key）。

用法: python scripts/test_web_mock.py
原理: monkeypatch qa.web_search，绕过真实网络请求，验证
      搜索结果是否被正确拼进 context、引用编号是否接在本地引用之后、
      以及 LLM 是否真的引用了 [n]。
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.agents.search import SearchResult  # noqa: E402
import app.agents.qa as qa  # noqa: E402
from app.services.store import get_store  # noqa: E402

FAKE = [
    SearchResult(
        "Tavily 官网介绍", "https://tavily.com",
        "Tavily 是面向大模型的搜索 API，返回结构化结果，适合 RAG 场景。", "tavily"),
    SearchResult(
        "2026 年 RAG 技术趋势", "https://example.com/rag-2026",
        "2026 年 RAG 的进展包括 Agentic RAG、多模态检索、长上下文与检索融合。", "tavily"),
]


def fake_search(query, max_results=None):
    print("  [mock] web_search <-", query[:60])
    return FAKE, "tavily"


qa.web_search = fake_search  # qa.py 用 from ... import，需 patch 到 qa 命名空间

store = get_store()

# 挑一篇真正有原文的文章；没有就用 data/test_article.md 现场造一篇
doc = next((d for d in store.list_docs("article") if store.get_text(d["id"]).strip()), None)
if doc is None:
    from app.services.store import make_doc

    src = pathlib.Path(__file__).resolve().parent.parent / "data" / "test_article.md"
    d = make_doc("mock_web_test.md", "article")
    store.save_doc(d)
    store.set_text(d["id"], src.read_text(encoding="utf-8"))
    doc = store.get_doc(d["id"])
    print("(created mock article)")
print("doc:", doc["id"], doc["filename"])
print()

r = qa.answer(doc["id"], "2026 年 RAG 有哪些新进展？", use_web="on")

print("used_web :", r.get("used_web"))
print("engine   :", r.get("engine"))
print("results  :", r.get("search_results"))
print()
print("refs:")
for x in r["refs"]:
    print(f"   [{x['index']}] {x['kind']:8} cited={str(x['cited']):5} {x['label'][:36]}")
print()
print("answer:")
print(r["answer"][:600])

web = [x for x in r["refs"] if x["kind"] == "web"]
print()
print("=== CHECK ===")
print("  web refs present :", len(web) == 2, f"({len(web)})")
print("  numbering ok     :", [x["index"] for x in web] == [2, 3],
      f"({[x['index'] for x in web]})")
print("  llm cited web    :", any(x["cited"] for x in web))