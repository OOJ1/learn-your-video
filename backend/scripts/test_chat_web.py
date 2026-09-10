"""真实联网问答端到端测试（需要已配置 TAVILY_API_KEY，后端需在运行）。

用法: python scripts/test_chat_web.py
验证: 搜索是否真的被触发、引用是否带 web 类型且可被 LLM 引用。
"""
import json
import pathlib
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

BASE = "http://127.0.0.1:8000"


def get(u):
    return json.loads(urllib.request.urlopen(u, timeout=30).read())


def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=300).read())


cfg = get(f"{BASE}/api/config")
print("has_tavily_key:", cfg.get("has_tavily_key"))
if not cfg.get("has_tavily_key"):
    sys.exit("未配置 Tavily Key")

arts = get(f"{BASE}/api/articles")["items"]
if not arts:
    sys.exit("没有文章文档")

# 挑一篇真正有原文的（历史残留的空文档会让后端返回 400）
doc = None
for d in arts:
    try:
        if get(f"{BASE}/api/articles/{d['id']}/text?limit=1").get("chars", 0) > 0:
            doc = d
            break
    except Exception:
        continue
if doc is None:
    sys.exit("没有带原文的文章文档，请先上传一篇")
print("doc:", doc["id"], doc["filename"])

q = "2026 年 LangChain 有哪些重要更新？"
print("question:", q)
print()

r = post("/api/chat", {"doc_id": doc["id"], "question": q, "use_web": "on"})

print("used_web     :", r.get("used_web"))
print("engine       :", r.get("engine"))
print("results      :", r.get("search_results"))
print("search_error :", r.get("search_error"))
print()
print("refs:")
for x in r.get("refs", []):
    print(f"   [{x['index']}] {x['kind']:8} cited={str(x['cited']):5} {(x.get('label') or '')[:40]}")
print()
print("answer:")
print((r.get("answer") or "")[:800])

web = [x for x in r.get("refs", []) if x["kind"] == "web"]
print()
print("=== CHECK ===")
print("  web search fired :", bool(r.get("used_web")))
print("  web refs         :", len(web))
print("  llm cited web    :", any(x["cited"] for x in web))