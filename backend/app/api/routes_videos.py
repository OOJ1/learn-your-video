"""视频模块路由：上传(带热词) → 转写 → 向量化 → 摘要 / 字幕 / 播放。"""
from __future__ import annotations

import json
import logging
import pathlib
import re
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from app.config import get_settings
from app.services.article import to_markdown
from app.services.parsers import SUPPORTED_VIDEO_EXT
from app.services.store import DocStatus, get_store, make_doc
from app.services.video import process_video, probe_duration, regenerate_video_summary
from app.services.vector import get_vector_store

logger = logging.getLogger("app.api.videos")

router = APIRouter(prefix="/api/videos", tags=["videos"])

MAX_UPLOAD_MB = 1024
VIDEO_MIME = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo", ".webm": "video/webm", ".m4v": "video/mp4",
    ".flv": "video/x-flv",
}


def _safe_name(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1]
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", name).strip() or "unnamed"


@router.post("/upload")
async def upload_video(background: BackgroundTasks,
                       file: UploadFile = File(...),
                       hotwords: str = Form("")):
    s = get_settings()
    filename = _safe_name(file.filename or "unnamed")
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in SUPPORTED_VIDEO_EXT:
        raise HTTPException(400, f"不支持的视频格式 {ext or '(无扩展名)'}，支持 {sorted(SUPPORTED_VIDEO_EXT)}")

    upload_dir = s.data_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    doc = make_doc(filename, "video", hotwords=hotwords.strip())
    target = upload_dir / f"{doc['id']}_{filename}"

    size = 0
    with target.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                f.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"视频超过 {MAX_UPLOAD_MB}MB 上限")
            f.write(chunk)

    doc["size"] = size
    doc["path"] = str(target)
    doc["duration"] = probe_duration(target)
    store = get_store()
    store.save_doc(doc)

    background.add_task(process_video, doc["id"], target, hotwords.strip())
    return {"ok": True, "doc": doc}


@router.get("")
def list_videos():
    docs = get_store().list_docs("video")
    return {"ok": True, "items": [
        {k: v for k, v in d.items() if k not in ("path", "subtitles")} for d in docs
    ]}


@router.get("/{doc_id}")
def get_video(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d or d.get("type") != "video":
        raise HTTPException(404, "视频不存在")
    return {"ok": True, "doc": {k: v for k, v in d.items() if k != "path"}}


@router.get("/{doc_id}/status")
def get_status(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d:
        raise HTTPException(404, "视频不存在")
    return {"ok": True, "status": d.get("status"), "progress": d.get("progress", 0),
            "message": d.get("message", ""), "ready": d.get("status") == DocStatus.READY}


@router.get("/{doc_id}/file")
def stream_video(doc_id: str):
    """供前端播放器使用，支持 Range 请求以实现时间轴拖动/跳转"""
    d = get_store().get_doc(doc_id)
    if not d or not d.get("path"):
        raise HTTPException(404, "视频不存在")
    p = pathlib.Path(d["path"])
    if not p.exists():
        raise HTTPException(404, "视频文件已丢失")
    ext = p.suffix.lower()
    return FileResponse(str(p), media_type=VIDEO_MIME.get(ext, "video/mp4"),
                        filename=d.get("filename", p.name))


@router.get("/{doc_id}/subtitles")
def get_subtitles(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d:
        raise HTTPException(404, "视频不存在")
    jp = (d.get("subtitles") or {}).get("subs_json")
    if not jp or not pathlib.Path(jp).exists():
        return {"ok": True, "segments": [], "ready": False}
    segments = json.loads(pathlib.Path(jp).read_text(encoding="utf-8"))
    return {"ok": True, "segments": segments, "ready": True}


@router.get("/{doc_id}/srt")
def download_srt(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d:
        raise HTTPException(404, "视频不存在")
    sp = (d.get("subtitles") or {}).get("srt")
    if not sp or not pathlib.Path(sp).exists():
        raise HTTPException(404, "字幕尚未生成")
    base = (d.get("filename") or "subtitle").rsplit(".", 1)[0]
    return Response(
        content=pathlib.Path(sp).read_bytes(),
        media_type="application/x-subrip; charset=utf-8",
        headers={"Content-Disposition":
                 f"attachment; filename*=UTF-8''{quote(base + '.srt')}"},
    )


@router.get("/{doc_id}/export")
def export_video(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d or d.get("type") != "video":
        raise HTTPException(404, "视频不存在")
    md = to_markdown(d)
    base = (d.get("filename") or "summary").rsplit(".", 1)[0]
    return Response(
        content=md.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition":
                 f"attachment; filename*=UTF-8''{quote(base + '_总结.md')}"},
    )


@router.post("/{doc_id}/retry")
def retry_video(doc_id: str, background: BackgroundTasks):
    """重跑完整流水线（转写+向量化+摘要）。用于 failed 状态恢复。"""
    d = get_store().get_doc(doc_id)
    if not d or d.get("type") != "video":
        raise HTTPException(404, "视频不存在")
    p = d.get("path")
    if not p or not pathlib.Path(p).exists():
        raise HTTPException(400, "原始视频文件已丢失，请重新上传")
    background.add_task(process_video, doc_id, pathlib.Path(p), d.get("hotwords", "") or "")
    return {"ok": True, "message": "已重新开始处理"}


@router.post("/{doc_id}/resummarize")
def resummarize_video(doc_id: str, background: BackgroundTasks):
    """只重跑摘要与含金量评分，复用已有转写（比全流程快得多）。"""
    d = get_store().get_doc(doc_id)
    if not d or d.get("type") != "video":
        raise HTTPException(404, "视频不存在")
    if not get_store().get_text(doc_id):
        raise HTTPException(400, "尚无转写文本，请点「重试」重跑完整流程")
    background.add_task(regenerate_video_summary, doc_id)
    return {"ok": True, "message": "已重新生成摘要与评分"}


@router.delete("/{doc_id}")
def delete_video(doc_id: str):
    store = get_store()
    d = store.get_doc(doc_id)
    if not d:
        raise HTTPException(404, "视频不存在")
    for key in ("path",):
        if d.get(key):
            pathlib.Path(d[key]).unlink(missing_ok=True)
    for p in (d.get("subtitles") or {}).values():
        pathlib.Path(p).unlink(missing_ok=True)
    audio = get_settings().data_path / "audio" / f"{doc_id}.wav"
    audio.unlink(missing_ok=True)
    try:
        get_vector_store().delete_doc(doc_id)
    except Exception as e:
        # 不阻断记录删除，但要留下痕迹——静默吞错会留下孤儿向量，
        # 使已删除的视频仍能被问答检索到。
        logger.warning("删除视频 %s 的向量失败（已保留记录删除）：%s", doc_id, e)
    store.delete_doc(doc_id)
    return {"ok": True}
