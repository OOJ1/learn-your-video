# 长视频 RAG 问答端到端
import json
import urllib.request

BASE = "http://127.0.0.1:8000"
DID = "v_527da4f629a0"


def post(u, payload):
    req = urllib.request.Request(
        BASE + u, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=600).read())


q = "黄仁勋如何看待AI算力的经济价值？他提出了哪些关键判断？"
print("问题:", q)
print()
r = post("/api/chat", {"doc_id": DID, "question": q, "use_web": "off"})
print("ok =", r.get("ok"), "| used_web =", r.get("used_web"))
print()
print("回答:")
print((r.get("answer") or "")[:600])
print()
print("引用:")
for ref in r.get("refs", []):
    ts = f"{ref.get('start', 0):.0f}s-{ref.get('end', 0):.0f}s"
    print(f"  [{ref.get('index')}] {ref.get('kind')} {ts} cited={ref.get('cited')} {str(ref.get('snippet'))[:50]}")
