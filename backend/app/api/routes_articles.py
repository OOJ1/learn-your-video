"""文章模块路由：上传 → 异步处理 → 摘要 → 导出。"""
from __future__ import annotations

import pathlib
import re
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.config import get_settings
from app.services.article import process_article, to_markdown
from app.services.parsers import SUPPORTED_ARTICLE_EXT, SUPPORTED_PDF_EXT, ParseError
from app.services.store import DocStatus, get_store, make_doc

router = APIRouter(prefix="/api/articles", tags=["articles"])

ALLOWED = SUPPORTED_ARTICLE_EXT | SUPPORTED_PDF_EXT
MAX_UPLOAD_MB = 50


def _safe_name(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1]
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", name).strip() or "unnamed"


@router.post("/upload")
async def upload_article(background: BackgroundTasks, file: UploadFile = File(...)):
    s = get_settings()
    filename = _safe_name(file.filename or "unnamed")
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in ALLOWED:
        raise HTTPException(400, f"不支持的文件类型 {ext or '(无扩展名)'}，仅支持 {sorted(ALLOWED)}")

    upload_dir = s.data_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    doc = make_doc(filename, "article")
    # 文件名前缀带 doc_id，避免同名覆盖
    target = upload_dir / f"{doc['id']}_{filename}"

    size = 0
    with target.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                f.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, f"文件超过 {MAX_UPLOAD_MB}MB 上限")
            f.write(chunk)

    doc["size"] = size
    doc["path"] = str(target)
    store = get_store()
    store.save_doc(doc)

    background.add_task(process_article, doc["id"], target)
    return {"ok": True, "doc": doc}


@router.get("")
def list_articles():
    docs = get_store().list_docs("article")
    # 列表不返回原文，避免响应体过大
    return {"ok": True, "items": [
        {k: v for k, v in d.items() if k not in ("path",)} for d in docs
    ]}


@router.get("/{doc_id}")
def get_article(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d or d.get("type") != "article":
        raise HTTPException(404, "文档不存在")
    d = {k: v for k, v in d.items() if k != "path"}
    return {"ok": True, "doc": d}


@router.get("/{doc_id}/text")
def get_article_text(doc_id: str, limit: int = 2000):
    store = get_store()
    d = store.get_doc(doc_id)
    if not d:
        raise HTTPException(404, "文档不存在")
    text = store.get_text(doc_id)
    return {"ok": True, "chars": len(text), "preview": text[:limit],
            "truncated": len(text) > limit}


@router.get("/{doc_id}/export")
def export_article(doc_id: str):
    store = get_store()
    d = store.get_doc(doc_id)
    if not d or d.get("type") != "article":
        raise HTTPException(404, "文档不存在")
    md = to_markdown(d)
    base = (d.get("filename") or "summary").rsplit(".", 1)[0]
    fname = quote(f"{base}_总结.md")
    return Response(
        content=md.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@router.post("/{doc_id}/resummarize")
def resummarize(doc_id: str, background: BackgroundTasks):
    store = get_store()
    d = store.get_doc(doc_id)
    if not d or d.get("type") != "article":
        raise HTTPException(404, "文档不存在")
    if not store.get_text(doc_id):
        raise HTTPException(400, "原文尚未解析完成，请稍后重试")
    background.add_task(process_article, doc_id, pathlib.Path(d["path"]))
    return {"ok": True, "message": "已重新生成摘要"}


@router.post("/{doc_id}/retry")
def retry_article(doc_id: str, background: BackgroundTasks):
    """重跑完整流水线（解析+摘要）。用于 failed 状态恢复。"""
    store = get_store()
    d = store.get_doc(doc_id)
    if not d or d.get("type") != "article":
        raise HTTPException(404, "文档不存在")
    p = d.get("path")
    if not p or not pathlib.Path(p).exists():
        raise HTTPException(400, "原始文件已丢失，请重新上传")
    background.add_task(process_article, doc_id, pathlib.Path(p))
    return {"ok": True, "message": "已重新开始处理"}


@router.delete("/{doc_id}")
def delete_article(doc_id: str):
    store = get_store()
    d = store.get_doc(doc_id)
    if not d:
        raise HTTPException(404, "文档不存在")
    if d.get("path"):
        pathlib.Path(d["path"]).unlink(missing_ok=True)
    store.delete_doc(doc_id)
    return {"ok": True}


@router.get("/{doc_id}/status")
def get_status(doc_id: str):
    d = get_store().get_doc(doc_id)
    if not d:
        raise HTTPException(404, "文档不存在")
    return {"ok": True, "status": d.get("status"), "progress": d.get("progress", 0),
            "message": d.get("message", ""), "ready": d.get("status") == DocStatus.READY}
