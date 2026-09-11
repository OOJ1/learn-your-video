"""视频处理流水线：FFmpeg 抽音频 → Whisper(热词) 转写 → 带时间戳切分 → ChromaDB 向量化。"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("app.video")

from app.config import get_settings
from app.core.hf import ensure_hf_env
from app.core.llm import LLMError, chat_json, get_llm
from app.core.schema import normalize_notes, normalize_text
from app.services.article import truncate_for_prompt
from app.services.store import DocStatus, get_store
from app.services.vector import get_vector_store

_whisper = None


class VideoError(RuntimeError):
    pass


def resolve_ffmpeg() -> str:
    s = get_settings()
    if s.FFMPEG_PATH and Path(s.FFMPEG_PATH).exists():
        return s.FFMPEG_PATH
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        raise VideoError(
            "未找到 FFmpeg。请执行 pip install imageio-ffmpeg（内置二进制），"
            f"或在 .env 设置 FFMPEG_PATH 指向 ffmpeg.exe。原始错误：{e}"
        ) from e


def probe_duration(path: Path) -> float:
    """从 ffmpeg 输出解析时长（imageio-ffmpeg 不含 ffprobe，只能解析 stderr）"""
    try:
        p = subprocess.run([resolve_ffmpeg(), "-i", str(path)],
                           capture_output=True, text=True, encoding="utf-8", errors="ignore",
                           timeout=60)
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", p.stderr or "")
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except Exception:
        pass
    return 0.0


def extract_audio(video: Path, out_wav: Path) -> Path:
    """抽 16kHz 单声道 wav —— Whisper 的最佳输入格式"""
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    p = subprocess.run(
        [resolve_ffmpeg(), "-y", "-i", str(video),
         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(out_wav)],
        capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=3600,
    )
    if p.returncode != 0 or not out_wav.exists():
        raise VideoError(f"FFmpeg 抽音频失败：{(p.stderr or '')[-400:]}")
    return out_wav


def get_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    s = get_settings()
    ensure_hf_env()
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise VideoError("未安装 faster-whisper，请执行 pip install faster-whisper") from e
    try:
        _whisper = WhisperModel(
            s.WHISPER_MODEL_SIZE,
            device=s.WHISPER_DEVICE,
            compute_type=s.WHISPER_COMPUTE_TYPE,
            download_root=str(s.data_path / "models"),
        )
    except Exception as e:
        raise VideoError(f"Whisper 模型加载失败（{s.WHISPER_MODEL_SIZE}）：{e}") from e
    return _whisper


def parse_hotwords(raw: str) -> list[str]:
    if not raw:
        return []
    return [h.strip() for h in re.split(r"[,，、;；\n\r\t]+", raw) if h.strip()]


def transcribe(audio: Path, hotwords: str = "",
               progress_cb=None) -> tuple[list[dict], float, str]:
    """转写。热词通过 initial_prompt 注入 + faster-whisper 的 hotwords 解码偏置双管齐下。

    progress_cb(ratio, elapsed_sec)：每当转写推进 >=2% 时回调，ratio 为 0~1，
    用于向前端同步实时进度（转写是同步阻塞的，不回调的话卡死和慢速无法区分）。
    """
    s = get_settings()
    model = get_whisper()
    hw = parse_hotwords(hotwords)

    initial_prompt = None
    extra: dict = {}
    if hw:
        initial_prompt = "以下是关于" + "、".join(hw) + "的语音内容。"
        extra["hotwords"] = " ".join(hw)  # faster-whisper >= 1.1 支持

    # language 缺省时交给 Whisper 自动检测语种。强制 zh 会让英文/中英混合视频
    # 被中文解码器污染（本次巡检发现 43 分钟英文访谈被错误标为 zh）。
    # WHISPER_LANGUAGE 留空或填 auto 即自动检测；填 zh/en/ja… 才强制指定。
    lang_opt = (s.WHISPER_LANGUAGE or "").strip()
    common = dict(beam_size=5, vad_filter=True, initial_prompt=initial_prompt)
    if lang_opt and lang_opt.lower() != "auto":
        common["language"] = lang_opt
    try:
        segments, info = model.transcribe(str(audio), **common, **extra)
    except TypeError:
        # 旧版本不支持 hotwords 参数，降级为仅 initial_prompt
        segments, info = model.transcribe(str(audio), **common)

    total = float(getattr(info, "duration", 0.0) or 0.0)
    # 以 Whisper 实际检测结果为准（auto 时 info.language 即检测语种）
    lang = str(getattr(info, "language", None) or lang_opt or "auto")
    logger.info("Whisper 开始转写 %s (duration=%.1fs, lang=%s)", audio.name, total, lang)

    segs: list[dict] = []
    last_ratio = 0.0
    for g in segments:
        if not (g.text and g.text.strip()):
            continue
        segs.append({"start": round(float(g.start), 2), "end": round(float(g.end), 2),
                     "text": g.text.strip()})
        if total > 0 and progress_cb is not None:
            ratio = min(1.0, float(g.end) / total)
            if ratio - last_ratio >= 0.02 or ratio >= 1.0:
                last_ratio = ratio
                logger.info("转写进度 %.0f%% (%.0fs/%.0fs)", ratio * 100, g.end, total)
                progress_cb(ratio, float(g.end))

    logger.info("Whisper 转写完成：%d 段", len(segs))
    return segs, total, lang


def split_with_timestamps(segments: list[dict], chunk_size: int, overlap: int) -> list[dict]:
    """用 RecursiveCharacterTextSplitter 切分，再把每个块映射回原始时间戳。"""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    parts, spans = [], []
    pos = 0
    for seg in segments:
        t = seg["text"].strip()
        if not t:
            continue
        parts.append(t)
        spans.append({"s": pos, "e": pos + len(t), "start": seg["start"], "end": seg["end"]})
        pos += len(t) + 1
    full = "\n".join(parts)
    if not full.strip():
        return []

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=overlap,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
    )
    texts = splitter.split_text(full)

    out, search_from = [], 0
    for i, ct in enumerate(texts):
        s = full.find(ct, search_from)
        if s < 0:
            s = full.find(ct)
        if s < 0:
            s = 0
        e = s + len(ct)
        search_from = max(0, e - overlap - 50)

        hit = [sp for sp in spans if sp["e"] > s and sp["s"] < e]
        if not hit:
            hit = [min(spans, key=lambda sp: abs(sp["s"] - s))]
        out.append({
            "text": ct.strip(),
            "start": min(h["start"] for h in hit),
            "end": max(h["end"] for h in hit),
            "index": i,
        })
    return out


def _fmt_clock(t: float) -> str:
    t = max(0, int(t))
    h, r = divmod(t, 3600)
    m, sec = divmod(r, 60)
    return f"{h:d}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def save_subtitles(doc_id: str, segments: list[dict]) -> dict:
    """落盘 JSON（前端时间轴用）+ SRT（可下载）"""
    s = get_settings()
    d = s.data_path / "subs"
    d.mkdir(parents=True, exist_ok=True)
    jp, sp = d / f"{doc_id}.json", d / f"{doc_id}.srt"
    jp.write_text(json.dumps(segments, ensure_ascii=False, indent=1), encoding="utf-8")
    sp.write_text(to_srt(segments), encoding="utf-8")
    return {"subs_json": str(jp), "srt": str(sp)}


def to_srt(segments: list[dict]) -> str:
    def fmt(t: float) -> str:
        h, r = divmod(int(t), 3600)
        m, sec = divmod(r, 60)
        ms = int(round((t - int(t)) * 1000))
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"

    return "\n\n".join(
        f"{i}\n{fmt(g['start'])} --> {fmt(g['end'])}\n{g['text']}"
        for i, g in enumerate(segments, 1)
    )


VIDEO_SUMMARY_TEMPLATE = """以下是某个视频的完整字幕文本（每行开头 [xx.xs] 是该句在视频中的起始秒数）。视频可能是任意类型（知识教程、访谈对话、会议记录、产品评测、vlog、新闻评论、娱乐综艺、广告带货等），请先判断类型，再按该类型的特点做内容归纳，不要预设它是教学视频。

【字幕】
{content}

输出 JSON（不要 markdown 代码块）：
{{
  "video_type": "视频类型，如：知识教程/访谈对话/会议记录/产品评测/vlog/新闻评论/娱乐综艺/其他",
  "one_liner": "一句话概括这个视频在讲什么，不超过 60 字",
  "key_points": [{{"t": 起始秒整数, "text": "核心要点1"}}, ... 3-6 条，每条 text 不超过 50 字],
  "review": "你对这条视频的评价与看法，120-250 字。要有明确观点：内容讲得好在哪、有什么不足或争议、值不值得花时间看、最适合谁看；不要复述剧情或罗列内容，也不要说空话。",
  "notes": [
    {{"title": "笔记小节标题（如：核心观点 / 方法步骤 / 关键数据 / 值得记的结论）",
      "points": ["这一节的知识点1", "知识点2"]}},
    ... 2-4 个小节，每节 2-4 条
  ],
  "tags": ["标签1", "... 2-5 个"],
  "value_score": {{
    "dimensions": {{
      "info_density": {{"score": 0到20的整数, "reason": "信息密度：单位时间有效信息量；水词多、重复啰嗦则低分"}},
      "practicality": {{"score": 0到20的整数, "reason": "实用性：能否直接指导行动、解决问题或学到可复用方法"}},
      "structure": {{"score": 0到20的整数, "reason": "结构清晰度：逻辑是否分明、是否有铺垫和结论"}},
      "uniqueness": {{"score": 0到20的整数, "reason": "观点独特性：是否有独到见解或一手经验，而非泛泛而谈"}},
      "timeliness": {{"score": 0到20的整数, "reason": "时效性：内容是否随时间失效，现在看是否仍有价值"}}
    }},
    "verdict": "一句话总体评价，不超过 40 字",
    "watch_advice": "从 必看/推荐看/可倍速/跳看指定段落/可跳过 中选一个，并附一句简短理由"
  }}
}}

要求：
- key_points 的每一项都必须带 "t" 字段：该要点在字幕中对应位置（或最近位置）的 [xx.xs] 秒数（整数），用于前端点击跳转视频；确实无法定位时给 null。
- notes 要整理成「能直接当复习笔记用」的知识条目：自己归纳、重组成体系，不要照抄字幕原句；可以补充必要的背景、因果和推论。每节 points 请写成完整的一句话，不要只写关键词。
- review 是评价而非总结：要敢于指出不足（如注水、观点陈旧、广告过多、结论跳跃），也要说明亮点。若内容确实平庸，直接说平庸，不要刻意恭维。
- review 写成一段连续的文字，不要手动换行（换行会破坏 JSON）。
- 文本内容中禁止使用英文双引号 \"（引用词语请用「」），否则会破坏 JSON 格式。
- 评分：每个维度 0-20 的整数，五维之和即总分（0-100）。请严格依据字幕内容打分，不要一味给高分；娱乐类视频实用性可低但信息密度未必低。"""


SCORE_DIMS = {
    "info_density": "信息密度",
    "practicality": "实用性",
    "structure": "结构清晰度",
    "uniqueness": "观点独特性",
    "timeliness": "时效性",
}


def _score_level(total: int) -> str:
    if total >= 85:
        return "含金量高"
    if total >= 70:
        return "含金量较高"
    if total >= 50:
        return "含金量中等"
    if total >= 30:
        return "含金量较低"
    return "含金量低"


def _normalize_score(data: dict) -> None:
    """规整 LLM 返回的评分：维度缺失补 0、越界截断、自动算总分。

    兼容两种写法：{"score": 15, "reason": "..."} 或直接给数字 15。
    """
    vs = data.get("value_score")
    if not isinstance(vs, dict):
        data["value_score"] = None
        return

    raw = vs.get("dimensions")
    dims, total = {}, 0
    if isinstance(raw, dict):
        for key, label in SCORE_DIMS.items():
            item = raw.get(key)
            score = item.get("score") if isinstance(item, dict) else item
            try:
                score = int(round(float(score)))
            except (TypeError, ValueError):
                score = 0
            score = max(0, min(20, score))
            reason = item.get("reason", "") if isinstance(item, dict) else ""
            dims[key] = {"label": label, "score": score, "reason": str(reason)[:150]}
            total += score

    data["value_score"] = {
        "dimensions": dims,
        "total": total,
        "level": _score_level(total),
        "verdict": str(vs.get("verdict", ""))[:150],
        "watch_advice": str(vs.get("watch_advice", ""))[:150],
    }


def _normalize_points(data: dict) -> None:
    """规整 key_points：统一为 {"t": 秒数|None, "text": str}。

    兼容三种 LLM 返回写法：字符串（无时间戳）、{"t":..,"text":..}、["12s 文本"] 等；
    同时兼容旧版本已落盘的纯字符串列表（前端点击逻辑按 t 为空降级为不可跳转）。
    outline 是旧版字段，一并兜底规整，保证历史数据仍可渲染。
    """
    for field, limit in (("key_points", 8), ("outline", 5)):
        raw = data.get(field)
        if raw is None and field == "outline":
            continue  # outline 是旧版字段：模型没给就别凭空补一个空数组
        if not isinstance(raw, list):
            data[field] = []
            continue
        pts = []
        for item in raw[:limit]:
            if isinstance(item, dict):
                try:
                    t = int(round(float(item.get("t")))) if item.get("t") is not None else None
                except (TypeError, ValueError):
                    t = None
                pts.append({"t": max(0, t) if t is not None else None,
                            "text": str(item.get("text", "")).strip()[:80]})
            elif isinstance(item, (int, float)):
                pts.append({"t": max(0, int(item)), "text": ""})
            else:
                pts.append({"t": None, "text": str(item).strip()[:80]})
        data[field] = [p for p in pts if p["text"] or p["t"] is not None]


def generate_video_summary(transcript: str) -> dict:
    s = get_settings()
    # 取首+尾而非截头：开头结论与结尾总结都要保留，同时给模型的输出留出上下文空间
    content, _ = truncate_for_prompt(transcript, s.SUMMARY_INPUT_CHARS)
    fallback = {"one_liner": "（摘要生成失败）", "key_points": [], "review": "", "notes": [],
                "tags": [], "value_score": None}
    try:
        data = chat_json(get_llm(), [
            {"role": "system",
             "content": "你是视频内容分析助手，能客观归纳任意类型的视频、给出含金量评分，"
                        "并写出一份有观点、可直接当复习笔记用的知识整理。"
                        "严格按 JSON 输出，不要 markdown 代码块。"},
            {"role": "user", "content": VIDEO_SUMMARY_TEMPLATE.format(content=content)},
        ], default=fallback, max_tokens=s.SUMMARY_MAX_TOKENS)
    except LLMError as e:
        data = dict(fallback)
        data["one_liner"] = f"（摘要生成失败：{e}）"
    _normalize_score(data)
    _normalize_points(data)
    normalize_text(data, "review", 1200)
    normalize_notes(data)
    return data


def regenerate_video_summary(doc_id: str) -> None:
    """只重跑摘要与评分，复用已有转写结果（比全流程重试快得多）"""
    store = get_store()
    transcript = store.get_text(doc_id)
    if not transcript.strip():
        raise VideoError("尚无转写文本，请点「重试」重跑完整流程")

    # 时间戳已由摘要里的「核心要点」自带，无需再单独生成全片时间轴；
    # 顺便清掉旧版遗留的 timeline 数据。
    doc = store.get_doc(doc_id) or {}
    if doc.pop("timeline", None) is not None:
        store.save_doc(doc)

    store.set_status(doc_id, DocStatus.SUMMARIZING, 85, "重新生成摘要中")
    try:
        summary = generate_video_summary(transcript)
    except Exception as e:
        store.set_status(doc_id, DocStatus.FAILED, 100, f"{type(e).__name__}: {e}")
        doc = store.get_doc(doc_id) or {}
        doc["error"] = str(e)
        store.save_doc(doc)
        return

    doc = store.get_doc(doc_id) or {}
    # 生成失败时保留旧摘要，避免把好的数据覆盖成空壳
    if str(summary.get("one_liner", "")).startswith("（摘要生成失败") and doc.get("summary"):
        doc["error"] = "本次摘要生成失败，已保留原有摘要；可再次点击「重新生成」"
        store.save_doc(doc)
        store.set_status(doc_id, DocStatus.READY, 100)
        return

    doc["summary"] = summary
    doc.pop("error", None)
    store.save_doc(doc)
    store.set_status(doc_id, DocStatus.READY, 100)


def process_video(doc_id: str, video_path: Path, hotwords: str = "") -> None:
    store = get_store()
    try:
        s = get_settings()
        # 幂等：重试时先清掉旧向量块，否则 ChromaDB 会重复堆积导致检索出双份
        try:
            get_vector_store().delete_doc(doc_id)
        except Exception:
            pass
        store.set_status(doc_id, DocStatus.PARSING, 10, "抽取音轨")
        # 以 FFmpeg 探测为准：Whisper 在 vad_filter 下返回的 duration 是剔除静音后的，
        # 比视频真实长度短，会导致前端进度条/跳转对不上
        real_duration = probe_duration(video_path)
        audio_dir = s.data_path / "audio"
        audio = extract_audio(video_path, audio_dir / f"{doc_id}.wav")

        store.set_status(doc_id, DocStatus.TRANSCRIBING, 30, "语音转写中")

        def _on_progress(ratio: float, elapsed: float) -> None:
            # 转写占用 30%~62% 的总进度
            store.set_status(doc_id, DocStatus.TRANSCRIBING, 30 + int(ratio * 32),
                             f"语音转写中 {_fmt_clock(elapsed)} / {_fmt_clock(real_duration or total_hint)}")

        total_hint = probe_duration(audio)  # wav 时长与视频一致，用于进度显示
        segments, duration, lang = transcribe(audio, hotwords, progress_cb=_on_progress)
        if not segments:
            raise VideoError("未识别到任何语音内容（可能是静音视频，或语言设置不匹配）")

        transcript = "\n".join(f"[{g['start']:.1f}s] {g['text']}" for g in segments)
        store.set_text(doc_id, transcript)

        doc = store.get_doc(doc_id) or {}
        doc.update(duration=round(real_duration or duration, 2), language=lang,
                   segments=len(segments),
                   chars=len(transcript), subtitles=save_subtitles(doc_id, segments))
        store.save_doc(doc)

        # 时间戳来源改为摘要里的「核心要点」（模型直接给出每条要点的起始秒数），
        # 不再单独跑一遍全片分段概括，省掉长视频十几次模型调用。
        store.set_status(doc_id, DocStatus.EMBEDDING, 64, "向量化中")
        chunks = split_with_timestamps(segments, s.CHUNK_SIZE, s.CHUNK_OVERLAP)
        get_vector_store().add_chunks(doc_id, chunks)

        store.set_status(doc_id, DocStatus.SUMMARIZING, 85, "生成摘要中")
        summary = generate_video_summary(transcript)

        doc = store.get_doc(doc_id) or {}
        doc["summary"] = summary
        doc["chunks"] = len(chunks)
        # 旧版记录里的 timeline 字段不再生成；重跑一次即会自然清空
        doc.pop("timeline", None)
        store.save_doc(doc)
        store.set_status(doc_id, DocStatus.READY, 100)
    except Exception as e:
        store.set_status(doc_id, DocStatus.FAILED, 100, f"{type(e).__name__}: {e}")
        doc = store.get_doc(doc_id) or {}
        doc["error"] = str(e)
        store.save_doc(doc)
