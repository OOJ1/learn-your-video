"""视频抓取：yt-dlp 下载 + 自动转码为可直接播放的 H.264。

设计要点：
- 任务在后台线程执行，前端靠 /api/grabber/jobs/{id} 轮询进度
- 下载完成后探测编码，非 h264/vp8/vp9 才转码（AV1 在 Windows 上很多播放器放不了）
- 转码用 resolve_ffmpeg()（优先 imageio-ffmpeg 内置二进制，无需用户装 FFmpeg）
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.services.video import probe_duration, resolve_ffmpeg

logger = logging.getLogger("app.grabber")

_PLAYABLE = ("h264", "avc1", "vp8", "vp9", "av01")

# job_id -> dict(status, progress, message, filename, size, path, error, title)
_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_loaded = False          # 是否已从磁盘恢复过任务记录
_last_dump = {"t": 0.0}  # 进度落盘节流用
_MAX_JOBS = 60           # 只保留最近的任务记录，防止无限增长


def grab_dir() -> Path:
    d = get_settings().data_path / "grabbed"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _jobs_file() -> Path:
    d = get_settings().data_path / "store"
    d.mkdir(parents=True, exist_ok=True)
    return d / "grabber.json"


def _dump() -> None:
    """把任务记录落盘。落盘失败绝不能影响下载主流程，所以只记日志。"""
    try:
        latest = sorted(_jobs.values(), key=lambda j: j.get("updated_at", 0), reverse=True)
        _jobs_file().write_text(
            json.dumps(latest[:_MAX_JOBS], ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        logger.warning("下载任务落盘失败：%s", e)


def _adopt_orphan_files() -> list[str]:
    """把 grabbed/ 里没有任务记录的文件重新登记为已完成任务。

    这些文件来自「任务落盘」之前的下载：任务只存在内存里，后端一重启，
    界面上就再也看不到它们，文件也取不回、删不掉，只能烂在磁盘上。
    文件命名是 {job_id}_{标题}.{ext}，据此重建记录。
    """
    known = set(_jobs)
    adopted: list[str] = []
    for f in sorted(grab_dir().iterdir()):
        if not f.is_file() or f.name.endswith((".part", ".ytdl", ".temp")):
            continue
        job_id, sep, rest = f.name.partition("_")
        if not sep or not job_id or job_id in known:
            continue
        _jobs[job_id] = {
            "id": job_id, "status": "done", "progress": 100,
            "message": "历史下载（已自动恢复）", "url": "", "filename": f.name,
            "path": str(f), "size": f.stat().st_size, "duration": 0,
            "title": rest, "codec": "", "error": "",
            "updated_at": f.stat().st_mtime,
        }
        known.add(job_id)
        adopted.append(f.name)
    return adopted


def _ensure_loaded() -> None:
    """首次使用时从磁盘恢复任务记录（只做一次）。"""
    global _loaded
    if _loaded:
        return
    _loaded = True
    try:
        for j in json.loads(_jobs_file().read_text(encoding="utf-8")):
            if not j.get("id"):
                continue
            # 进程重启后，running 任务的线程早已不存在，标记为已中断
            if j.get("status") == "running":
                j.update(status="failed", progress=100,
                         message="后端重启，任务已中断，请重新下载")
            _jobs[j["id"]] = j
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning("读取下载任务记录失败（忽略并重建）：%s", e)

    try:
        adopted = _adopt_orphan_files()
        if adopted:
            logger.info("已恢复 %d 个历史下载文件：%s", len(adopted), adopted)
            _dump()
    except Exception as e:
        logger.warning("恢复历史下载文件失败：%s", e)


def get_job(job_id: str) -> dict[str, Any] | None:
    _ensure_loaded()
    with _lock:
        return dict(_jobs.get(job_id) or {})


def list_jobs() -> list[dict[str, Any]]:
    _ensure_loaded()
    with _lock:
        return sorted((dict(v) for v in _jobs.values()),
                      key=lambda j: j.get("updated_at", 0), reverse=True)


def _set(job_id: str, **kw: Any) -> None:
    with _lock:
        j = _jobs.get(job_id)
        if j is None:
            return
        j.update(kw)
        j["updated_at"] = time.time()
        # 进度更新很频繁，做 1 秒节流；状态变化必须立刻落盘
        now = time.time()
        if "status" in kw or now - _last_dump["t"] >= 1.0:
            _last_dump["t"] = now
            _dump()


def probe_video_codec(path: Path) -> str:
    """用 ffprobe（有则用，无则解析 ffmpeg -i 输出）读取视频流编码名"""
    ffmpeg = resolve_ffmpeg()
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        try:
            p = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0",
                                "-show_entries", "stream=codec_name",
                                "-of", "default=nw=1:nk=1", str(path)],
                               capture_output=True, text=True, timeout=60)
            out = (p.stdout or "").strip()
            if out:
                return out.lower()
        except Exception:
            pass
    try:
        p = subprocess.run([ffmpeg, "-i", str(path)], capture_output=True, text=True,
                           encoding="utf-8", errors="ignore", timeout=60)
        m = re.search(r"Video:\s*([a-z0-9_]+)", p.stderr or "")
        if m:
            return m.group(1).lower()
    except Exception:
        pass
    return ""


def _transcode(src: Path) -> Path:
    """就地转码为 H.264（先输出临时文件再替换），保证生成的视频可直接播放"""
    tmp = src.with_name(src.stem + "_h264" + src.suffix)
    cmd = [resolve_ffmpeg(), "-y", "-i", str(src), "-c:v", "libx264", "-preset", "veryfast",
           "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", str(tmp)]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="ignore", timeout=7200)
    if p.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"转码失败：{(p.stderr or '')[-300:]}")
    src.unlink(missing_ok=True)
    tmp.rename(src)
    return src


def _friendly_error(raw: str) -> str:
    """把 yt-dlp 的英文报错转成对用户有用的中文提示，并保留原始信息便于排查。

    yt-dlp 的报错对普通用户几乎没有可读性，这里只覆盖最常见的几类。
    """
    text = raw.replace("\r", " ").replace("\n", " ").strip()
    low = text.lower()
    if any(k in low for k in ("more expected", "read timed out", "connection reset",
                              "incomplete read", "remote end closed", "timed out",
                              "connection aborted", "temporary failure")):
        return ("下载被中途中断：网络不稳定，或代理/防火墙限制了持续下载。"
                f"请检查网络与代理后重试。（原始信息：{text}）")
    if "403" in text or "forbidden" in low:
        return f"服务器拒绝访问（403），可能需要在设置里填入登录 Cookie。（原始信息：{text}）"
    if "video unavailable" in low or "not available" in low or "404" in text:
        return f"视频不可访问：可能已删除、设为私密或有地区限制。（原始信息：{text}）"
    if "unsupported url" in low:
        return f"暂不支持该链接，请换一个视频页面链接。（原始信息：{text}）"
    if "sign in" in low or "cookies" in low or "login" in low:
        return f"该视频需要登录才能下载，请在设置里配置 Cookie。（原始信息：{text}）"
    return text


def _download(job_id: str, url: str, max_height: int) -> None:
    import yt_dlp  # 延迟导入，未安装时只影响本功能

    out_dir = grab_dir()
    tpl = str(out_dir / f"{job_id}_%(title).80s.%(ext)s")
    last = {"pct": -1.0}

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            pct = 0.0
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            if total:
                pct = min(99.0, done / total * 100)
            if pct - last["pct"] >= 2:
                last["pct"] = pct
                _set(job_id, progress=int(pct), message=f"下载中 {int(pct)}%")
        elif d.get("status") == "finished":
            _set(job_id, progress=85, message="下载完成，检查编码格式")

    # yt-dlp 做音视频合并需要外部 ffmpeg，必须指向【完整文件路径】——
    # 只给目录时它在 Windows 上不会补 .exe，会误判为“未安装 ffmpeg”
    ff_dir = str(resolve_ffmpeg())
    opts = {
        "format": f"bv*[height<={max_height}]+ba/b[height<={max_height}]/bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": tpl,
        "progress_hooks": [hook],
        "noprogress": True,
        "quiet": True,
        "no_warnings": True,
        # 网络不稳时单条 HTTP 连接会被 CDN 中途掐断，典型报错是
        # 「Got error: N bytes read, M more expected. Giving up after 3 retries」。
        # 这类中断是可恢复的，把重试次数提高并做指数退避，避免大文件下到一半整体失败。
        "retries": 10,
        "fragment_retries": 10,
        "retry_sleep_functions": {
            "http": lambda n: min(2 ** n, 20),
            "fragment": lambda n: min(2 ** n, 20),
            "extractor": lambda n: min(2 ** n, 20),
        },
        "socket_timeout": 30,
        "ffmpeg_location": ff_dir,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info))
        # 合并后的实际后缀可能是 .mp4
        if not path.exists():
            cands = sorted(out_dir.glob(f"{job_id}_*"), key=lambda p: p.stat().st_mtime)
            if not cands:
                raise RuntimeError("下载完成但找不到输出文件")
            path = cands[-1]

        _set(job_id, path=str(path), filename=path.name)

        codec = probe_video_codec(path)
        _set(job_id, codec=codec)
        if codec and not any(c in codec for c in _PLAYABLE):
            _set(job_id, progress=88, message=f"检测到 {codec} 格式，正在转码为 H.264")
            path = _transcode(path)
            _set(job_id, path=str(path), filename=path.name, codec="h264")

        _set(job_id, status="done", progress=100, message="完成，可下载或导入知识库",
             size=path.stat().st_size,
             duration=probe_duration(path))
    except Exception as e:
        logger.exception("下载任务 %s 失败", job_id)
        _set(job_id, status="failed", progress=100,
             message=_friendly_error(str(e))[:300], error=str(e)[:500])


def start_download(url: str, max_height: int = 720) -> str:
    _ensure_loaded()
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[job_id] = {"id": job_id, "status": "running", "progress": 0,
                         "message": "正在解析链接…", "url": url, "filename": "",
                         "path": "", "size": 0, "duration": 0, "title": "",
                         "codec": "", "error": "", "updated_at": time.time()}
        _dump()
    threading.Thread(target=_download, args=(job_id, url, max_height), daemon=True).start()
    return job_id


def preview(url: str) -> dict:
    """只解析不下载，用于前端先确认标题/时长"""
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "socket_timeout": 30}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "title": info.get("title") or "",
        "duration": float(info.get("duration") or 0),
        "uploader": info.get("uploader") or info.get("channel") or "",
        "thumbnail": info.get("thumbnail") or "",
        "webpage_url": info.get("webpage_url") or url,
    }
