"""数据一致性巡检 + 清理孤儿数据。

背景：`VectorStore.delete_doc` 曾用 `except Exception: pass` 静默吞掉异常，
`delete_video` 路由也 `except: pass`，于是「记录已删、向量/文件还在」的孤儿
数据会长期残留——已删除的视频仍可能被问答检索到（本次巡检查出 2 个孤儿向量）。

用法（务必在**后端停止**时运行，chroma 是单进程 sqlite，避免并发写冲突）：

    python scripts/cleanup_orphans.py            # 只巡检，不改动
    python scripts/cleanup_orphans.py --apply    # 清掉孤儿向量 + 孤儿文件

孤儿向量默认建议清理；孤儿文件（uploads/audio/subs）与下载残片用 --apply 才会删除。

向量巡检需要独占 chroma（单进程 sqlite），**后端运行时建议先停后端**；
若检测到 chroma 被占用，脚本会跳过向量部分继续做文件巡检，不会中断。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

DATA = BACKEND / "data"
STORE = DATA / "store"


def load(name: str) -> dict:
    p = STORE / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def check_vectors(docs: dict, apply: bool) -> None:
    """孤儿向量检查（记录已删、向量残留）。chroma 被占用时由调用方兜底。"""
    from app.services.vector import get_vector_store

    vs = get_vector_store()
    per_doc = vs.doc_ids()
    orphans = sorted(k for k in per_doc if k not in docs)
    print(f"\n向量库: {vs.count()} 块 / {len(per_doc)} 个文档")
    if not orphans:
        print("孤儿向量: 无 ✓")
        return
    print(f"孤儿向量 {len(orphans)} 个（记录已删、向量残留）:")
    for k in orphans:
        print(f"  {k}  {per_doc[k]} 块")
    if apply:
        for k in orphans:
            n = vs.delete_doc(k)
            print(f"  已删除 {k}: {n} 块")
    else:
        print("  → 加 --apply 清理")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="执行清理（默认仅巡检）")
    ap.add_argument("--skip-vectors", action="store_true", help="跳过向量库检查")
    args = ap.parse_args()

    docs = load("docs.json")
    texts = load("texts.json")
    chats = load("chat.json")

    print(f"记录数: docs={len(docs)} texts={len(texts)} chat={len(chats)}")

    # ---------- 1. 孤儿向量 ----------
    # chroma 是单进程 sqlite，后端在跑时可能拿不到；拿不到就跳过，不影响文件巡检。
    if args.skip_vectors:
        print("\n向量检查: 已按 --skip-vectors 跳过")
    else:
        try:
            check_vectors(docs, args.apply)
        except Exception as e:
            print(f"\n⚠ 跳过向量检查（chroma 不可用，通常因为后端正在运行）: "
                  f"{type(e).__name__}: {e}")
            print("  如需检查孤儿向量，请先停后端再运行本脚本。")

    # ---------- 2. 孤儿文件 ----------
    used_uploads = {Path(d["path"]).name for d in docs.values() if d.get("path")}
    used_subs = set()
    for d in docs.values():
        for p in (d.get("subtitles") or {}).values():
            used_subs.add(Path(p).name)

    checks = [
        ("uploads", DATA / "uploads", used_uploads, False),
        ("subs", DATA / "subs", used_subs, False),
        ("audio", DATA / "audio", {f"{k}.wav" for k in docs}, False),
    ]
    for label, folder, used, _ in checks:
        if not folder.exists():
            continue
        stray = [f for f in sorted(folder.iterdir())
                 if f.is_file() and f.name not in used]
        if not stray:
            print(f"\n{label}/: 无孤儿文件 ✓")
            continue
        print(f"\n{label}/ 孤儿文件 {len(stray)} 个（未被任何记录引用）:")
        for f in stray:
            print(f"  {f.name}  ({f.stat().st_size // 1024} KB)")
        if args.apply:
            for f in stray:
                f.unlink()
            print(f"  已删除 {len(stray)} 个文件")
        else:
            print("  → 加 --apply 清理（test_* 之类的测试残留通常可安全删除）")

    # ---------- 3. 下载残片 ----------
    # 下载被中断时 yt-dlp 会在 grabbed/ 留下 .part / .ytdl 临时文件。
    # 这些残片无法续传（任务状态只存在内存里，重启即丢），纯占磁盘空间。
    grabbed = DATA / "grabbed"
    if grabbed.exists():
        temps = [f for f in sorted(grabbed.iterdir())
                 if f.is_file() and f.name.endswith((".part", ".ytdl", ".temp"))]
        if not temps:
            print("\ngrabbed/: 无下载残片 ✓")
        else:
            total_mb = sum(f.stat().st_size for f in temps) // 1024 // 1024
            print(f"\ngrabbed/ 下载残片 {len(temps)} 个（中断的下载，无法续传）合计 {total_mb} MB:")
            for f in temps:
                print(f"  {f.name}  ({f.stat().st_size // 1024 // 1024} MB)")
            if args.apply:
                for f in temps:
                    f.unlink()
                print(f"  已删除 {len(temps)} 个残片，释放 {total_mb} MB")
            else:
                print("  → 加 --apply 清理")

    # ---------- 4. 记录缺转写 ----------
    broken = [k for k in docs if k.startswith("v_") and not texts.get(k)]
    if broken:
        print(f"\n⚠ 有记录但无转写文本（需重跑）: {broken}")


if __name__ == "__main__":
    main()
