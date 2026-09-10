"""视频全链路回归：上传 → 转写 → 向量化 → 摘要 + 含金量评分。

用法: python scripts/test_video_pipeline.py [视频路径]
"""
import json
import sys
import time
import urllib.request
import uuid

BASE = "http://127.0.0.1:8000"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "E:/study-buddy/backend/data/test_video.mp4"


def post_multipart(url, path, fields):
    boundary = uuid.uuid4().hex
    with open(path, "rb") as f:
        payload = f.read()
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="file"; filename="{path.split("/")[-1]}"\r\n'.encode()
    body += b"Content-Type: video/mp4\r\n\r\n"
    body += payload + b"\r\n"
    for k, v in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
        body += v.encode() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.loads(urllib.request.urlopen(req, timeout=600).read())


def get(url):
    return json.loads(urllib.request.urlopen(url, timeout=60).read())


r = post_multipart(f"{BASE}/api/videos/upload", VIDEO, {"hotwords": "RAG,检索增强生成,大模型"})
did = r["doc"]["id"]
print("uploaded:", did)
print()

for i in range(60):
    time.sleep(5)
    st = get(f"{BASE}/api/videos/{did}/status")
    print(f"  [{i*5:3d}s] {st['status']:12} {st['progress']:3d}%  {st['message'][:40]}")
    if st["status"] in ("ready", "failed"):
        break

d = get(f"{BASE}/api/videos/{did}")["doc"]
s = d.get("summary") or {}
print()
print("video_type :", s.get("video_type"))
print("one_liner  :", s.get("one_liner"))
print("key_points :", len(s.get("key_points") or []))
print("tags       :", s.get("tags"))

vs = s.get("value_score")
print()
if vs:
    print("=== VALUE SCORE ===")
    print("total  :", vs.get("total"), "|", vs.get("level"))
    for k, v in (vs.get("dimensions") or {}).items():
        print(f"   {v['label']:8} {v['score']:2d}/20   {v['reason'][:60]}")
    print("verdict:", vs.get("verdict"))
    print("advice :", vs.get("watch_advice"))
else:
    print("!! NO value_score")

print()
print("DOC_ID=" + did)