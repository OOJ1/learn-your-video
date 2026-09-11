"""视频抓取路由：解析链接 → 下载 → 自动转码 → 下载到本地 / 直接导入知识库。"""
from __future__ import annotations

import shutil
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings
from app.services import grabber
from app.services.store import get_store, make_doc
from app.services.video import process_video, probe_duration

router = APIRouter(prefix="/api/grabber", tags=["grabber"])


class PreviewIn(BaseModel):
    url: str


class DownloadIn(BaseModel):
    url: str
    max_height: int = 720


class ImportIn(BaseModel):
    hotwords: str = ""


@router.post("/preview")
def preview(data: PreviewIn):
    if not data.url.strip():
        raise HTTPException(400, "请填写视频链接")
    try:
        return {"ok": True, **grabber.preview(data.url.strip())}
    except Exception as e:
        raise HTTPException(400, f"解析失败：{type(e).__name__}: {e}"[:300])


@router.post("/download")
def download(data: DownloadIn):
    if not data.url.strip():
        raise HTTPException(400, "请填写视频链接")
    try:
        job_id = grabber.start_download(data.url.strip(), data.max_height or 720)
    except ImportError:
        raise HTTPException(500, "后端未安装 yt-dlp，请执行 pip install yt-dlp")
    return {"ok": True, "job_id": job_id}


@router.get("/jobs")
def jobs():
    return {"ok": True, "items": grabber.list_jobs()}


@router.get("/jobs/{job_id}")
def job(job_id: str):
    j = grabber.get_job(job_id)
    if not j:
        raise HTTPException(404, "任务不存在")
    return {"ok": True, "job": j}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    """删除下载记录并清理它的文件。

    下载的文件会一直留在 data/grabbed/ 里，之前没有任何删除入口，只能越积越多。
    已导入知识库的副本在 uploads/，不受影响。
    """
    r = grabber.delete_job(job_id)
    if not r.get("ok"):
        raise HTTPException(404, "任务不存在")
    return {"ok": True, "removed": r.get("removed", 0)}


@router.get("/jobs/{job_id}/file")
def job_file(job_id: str):
    """把下载好的视频返回给浏览器（触发另存为）"""
    j = grabber.get_job(job_id)
    if not j or j.get("status") != "done":
        raise HTTPException(404, "任务尚未完成")
    p = j.get("path")
    if not p:
        raise HTTPException(404, "文件不存在")
    from pathlib import Path
    path = Path(p)
    if not path.exists():
        raise HTTPException(404, "文件已被清理")
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=quote(path.name),
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(path.name)}"},
    )


@router.post("/jobs/{job_id}/import")
def import_to_lib(job_id: str, body: ImportIn, background: BackgroundTasks):
    """把已下载的视频复制进知识库并跑完整流水线（转写 + 向量 + 摘要）"""
    j = grabber.get_job(job_id)
    if not j or j.get("status") != "done":
        raise HTTPException(400, "任务尚未完成，无法导入")
    from pathlib import Path

    src = Path(j["path"])
    if not src.exists():
        raise HTTPException(404, "源文件已不存在")

    # 去掉下载时加的 job_id 前缀，知识库里显示干净的中文标题
    name = src.name
    if name.startswith(f"{job_id}_"):
        name = name[len(job_id) + 1:]

    s = get_settings()
    upload_dir = s.data_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    doc = make_doc(name, "video", hotwords=body.hotwords.strip())
    target = upload_dir / f"{doc['id']}_{name}"
    shutil.copy2(src, target)

    doc["size"] = target.stat().st_size
    doc["path"] = str(target)
    doc["duration"] = probe_duration(target)
    get_store().save_doc(doc)

    background.add_task(process_video, doc["id"], target, body.hotwords.strip())
    return {"ok": True, "doc": doc}
