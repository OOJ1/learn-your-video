"""验证 resummarize / retry：rerun 后 chunks 不应翻倍（幂等）。
用法: python scripts/test_retry.py <video_doc_id>
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8000"
if len(sys.argv) < 2:
    sys.exit("usage: python scripts/test_retry.py <video_doc_id>")
DID = sys.argv[1]


def get(u):
    return json.loads(urllib.request.urlopen(u, timeout=60).read())


def post(u):
    req = urllib.request.Request(u, data=b"", method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def wait_ready(tag, limit=80):
    for i in range(limit):
        time.sleep(5)
        st = get(f"{BASE}/api/videos/{DID}/status")
        if st["status"] in ("ready", "failed"):
            print(f"  {tag:12} -> {st['status']} ({(i+1)*5}s)")
            return st["status"]
    print(f"  {tag:12} -> TIMEOUT")
    return "timeout"


d = get(f"{BASE}/api/videos/{DID}")["doc"]
print("before : status =", d["status"], "| chunks =", d.get("chunks"))
print("         score  =", (d.get("summary") or {}).get("value_score", {}).get("total"))

print()
print("=== 1. resummarize (only re-summarize) ===")
print("  resp:", post(f"{BASE}/api/videos/{DID}/resummarize"))
wait_ready("resummarize")
d = get(f"{BASE}/api/videos/{DID}")["doc"]
print("  after: score  =", (d.get("summary") or {}).get("value_score", {}).get("total"),
      "| chunks =", d.get("chunks"))

print()
print("=== 2. retry (full pipeline / idempotency) ===")
print("  resp:", post(f"{BASE}/api/videos/{DID}/retry"))
wait_ready("retry")
d = get(f"{BASE}/api/videos/{DID}")["doc"]
print("  after: status =", d["status"], "| chunks =", d.get("chunks"))
print("         score  =", (d.get("summary") or {}).get("value_score", {}).get("total"))
print()
print("  [check] chunks must NOT double vs before")