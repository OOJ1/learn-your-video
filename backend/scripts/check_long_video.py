# 长视频流水线结果检验
import json
import urllib.request

BASE = "http://127.0.0.1:8000"
DID = "v_527da4f629a0"


def get(u):
    return json.loads(urllib.request.urlopen(BASE + u, timeout=60).read())


d = get(f"/api/videos/{DID}")["doc"]
print("== 基本信息 ==")
print("status   :", d["status"], "| duration:", d.get("duration"), "s")
print("segments :", d.get("segments"), "| chunks:", d.get("chunks"), "| lang:", d.get("language"))

s = d.get("summary") or {}
print()
print("== 摘要 ==")
print("类型     :", s.get("video_type"))
print("标题     :", s.get("title"))
print("一句话   :", s.get("one_liner"))
print("要点     :", len(s.get("key_points") or []), "条")
for kp in (s.get("key_points") or [])[:4]:
    if isinstance(kp, (list, tuple)):
        print("   -", kp[0], "->", str(kp[1])[:60])
    else:
        print("   -", str(kp)[:70])
print("标签     :", s.get("tags"))

vs = s.get("value_score")
if vs:
    print()
    print("== 含金量评分 ==")
    print("总分:", vs.get("total"), "|", vs.get("level"), "|", str(vs.get("comment"))[:60])
    for k, v in (vs.get("dimensions") or {}).items():
        print(f"   {k:14} {v.get('score')}/20  {str(v.get('reason'))[:46]}")
    print("建议     :", vs.get("advice"))

print()
print("== 字幕热词检验 ==")
subs = get(f"/api/videos/{DID}/subtitles")
items = subs.get("subtitles") or []
full = " ".join(x.get("text", "") for x in items)
print("字幕条数 :", len(items))
for w in ["黄仁勋", "英伟达", "摩根士丹利", "token", "算力", "AGI", "CUDA"]:
    print(f"   {w:8} 出现 {full.count(w)} 次")
print()
print("首条字幕:", (items[0].get("text", "") if items else "")[:80])
print("时间戳  :", items[0].get("start") if items else "-", "->", items[-1].get("end") if items else "-")
