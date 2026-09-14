"""视频画面识别：FFmpeg 均匀抽帧 → 视觉模型描述画面 → 带时间戳的画面要点。

设计要点：
- 只依赖已有能力：FFmpeg（imageio-ffmpeg 已随依赖分发）+ OpenAI 兼容的视觉模型。
- 与字幕链路解耦：识别失败只记日志并返回空，主流程继续走「仅字幕」摘要，不阻断处理。
- 时间戳与字幕对齐：抽帧时刻即画面要点的时间，前端可点击跳转到视频对应位置。
- 环形导入规避：resolve_ffmpeg / probe_duration 来自 video.py，在函数内部按需导入。
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
from pathlib import Path

from app.config import get_settings
from app.core.llm import get_vision_llm

logger = logging.getLogger("app.vision")


class VisionError(RuntimeError):
    pass


# 画面描述提示词：明确要求「屏幕上呈现了什么」，避免模型去猜画外音
VISION_PROMPT = """你在分析一个视频里按时间顺序抽取的 {n} 张画面，用于帮助理解视频内容。
请描述每张画面中「屏幕上实际呈现了什么」，重点包括：
- 幻灯片/PPT、图表、表格、代码、白板、地图、软件界面（说明主题与关键数据/结论）
- 屏幕上出现的关键文字（标题、数字、公式、标注），尽量原样抄录要点
- 主讲人/实拍场景/主要物体

要求：每张一句话，20-50 字，简体中文；不要臆测声音，看不到文字就说画面大意。
严格输出 JSON 数组（不要 markdown 代码块，也不要多余解释）：
[{{"i": 1, "text": "第 1 张画面的描述"}}, {{"i": 2, "text": "第 2 张画面的描述"}}]"""


def extract_frames(video: Path, out_dir: Path, *, interval: int, max_frames: int,
                   width: int) -> list[dict]:
    """在整段视频上均匀抽取若干帧并落盘为 jpg。

    返回 [{"t": 秒, "path": Path}]，按时间升序。帧数 = min(max_frames, 时长/interval)。
    """
    from app.services.video import probe_duration, resolve_ffmpeg

    ff = resolve_ffmpeg()
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("f_*.jpg"):
        old.unlink(missing_ok=True)

    dur = probe_duration(video)
    if dur and dur > 0:
        # 均匀覆盖整段：帧数受 max_frames 与 interval 双重约束
        n = max(1, min(max_frames, max(1, int(round(dur / max(1, interval))))))
        step = dur / n
        fps = n / dur
        vf = f"fps={fps:.6f},scale={width}:-2"
        times = [round(step * (k + 0.5), 2) for k in range(n)]
    else:
        # 探测不到时长：按固定间隔顺序抽，交给 -frames:v 截断
        n = max_frames
        step = float(max(1, interval))
        vf = f"fps=1/{int(step)},scale={width}:-2"
        times = [round(step * (k + 0.5), 2) for k in range(n)]

    cmd = [
        ff, "-y", "-i", str(video),
        "-vf", vf,
        "-frames:v", str(n),
        "-q:v", "3",
        str(out_dir / "f_%04d.jpg"),
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="ignore", timeout=1800)
    except subprocess.TimeoutExpired as e:
        raise VisionError(f"抽帧超时：{e}") from e

    files = sorted(out_dir.glob("f_*.jpg"))
    if not files:
        tail = (p.stderr or "")[-300:]
        raise VisionError(f"未能抽到任何画面：{tail}")

    return [{"t": times[i] if i < len(times) else round(step * (i + 0.5), 2),
             "path": f} for i, f in enumerate(files)]


def _parse_batch(raw: str, n: int) -> list[str]:
    """解析一批画面的描述：优先 JSON 数组，失败则按行拆分兜底。"""
    txt = (raw or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", txt, re.S)
    if m:
        txt = m.group(1).strip()

    a, b = txt.find("["), txt.rfind("]")
    if a != -1 and b > a:
        try:
            arr = json.loads(txt[a:b + 1])
            if isinstance(arr, list):
                out = [""] * n
                pos = 0
                for item in arr:
                    if isinstance(item, dict):
                        try:
                            idx = int(item.get("i", 0) or 0)
                        except (TypeError, ValueError):
                            idx = 0
                        desc = str(item.get("text") or item.get("desc") or
                                   item.get("description") or "").strip()
                        if 1 <= idx <= n:
                            out[idx - 1] = desc
                        continue
                    if isinstance(item, str) and pos < n:
                        out[pos] = item.strip()
                        pos += 1
                if any(out):
                    return out
        except Exception:
            pass

    lines = [re.sub(r"^\s*(\d+\s*[\.\)、:：\-]|\-|\*)\s*", "", ln).strip()
             for ln in txt.splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith(("[", "]", "{"))]
    return (lines + [""] * n)[:n]


def describe_frames(frames: list[dict], batch: int) -> list[dict]:
    """逐批把画面交给视觉模型描述，返回 [{"t": 秒, "text": 描述}]（丢弃空描述）。"""
    llm = get_vision_llm()
    if llm is None or not frames:
        return []

    batch = max(1, int(batch))
    out: list[dict] = []
    for start in range(0, len(frames), batch):
        group = frames[start:start + batch]
        try:
            imgs = [f["path"].read_bytes() for f in group]
            raw = llm.describe_images(VISION_PROMPT.format(n=len(group)), imgs)
            texts = _parse_batch(raw, len(group))
        except Exception as e:
            logger.warning("画面识别第 %d 批失败：%s", start // batch + 1, e)
            continue
        for f, txt in zip(group, texts):
            if txt:
                out.append({"t": f["t"], "text": txt[:200]})
    return out


def analyze_video(doc_id: str, video: Path) -> tuple[list[dict], list[dict]]:
    """完整画面识别：抽帧 → 描述。

    返回 (visual_timeline, frames)：
    - visual_timeline: [{"t": 秒, "text": 画面描述}]，供摘要与「画面要点」使用
    - frames: [{"t": 秒, "file": "f_0001.jpg"}]，供前端缩略图路由使用
    """
    s = get_settings()
    if not s.VISION_ENABLED:
        return [], []

    out_dir = s.data_path / "frames" / doc_id
    frames = extract_frames(
        video, out_dir,
        interval=s.VISION_FRAME_INTERVAL,
        max_frames=s.VISION_MAX_FRAMES,
        width=s.VISION_FRAME_WIDTH,
    )
    timeline = describe_frames(frames, s.VISION_BATCH)
    # 只保留「拿到描述」的帧：没有描述的帧多是纯色/无信息画面（模型只会回空），
    # 放进「关键帧」就是一排空缩略图，而且与「画面要点」对不上号。
    described = {round(x["t"], 2) for x in timeline}
    filemap = [{"t": f["t"], "file": f["path"].name} for f in frames
               if round(f["t"], 2) in described]
    logger.info("画面识别：抽帧 %d，成功描述 %d", len(frames), len(timeline))
    return timeline, filemap


def frames_dir(doc_id: str) -> Path:
    return get_settings().data_path / "frames" / doc_id
