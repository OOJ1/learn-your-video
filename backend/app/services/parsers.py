"""文件解析：txt / md / pdf 抽取纯文本。"""
from __future__ import annotations

from pathlib import Path

SUPPORTED_ARTICLE_EXT = {".txt", ".md", ".markdown"}
SUPPORTED_PDF_EXT = {".pdf"}
SUPPORTED_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".flv"}


class ParseError(RuntimeError):
    pass


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "utf-8-sig", "gbk", "gb18030", "big5"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def _read_pdf(path: Path) -> tuple[str, dict]:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise ParseError("未安装 pypdf，请执行 pip install pypdf") from e
    try:
        reader = PdfReader(str(path))
    except Exception as e:
        raise ParseError(f"PDF 打开失败（文件可能损坏或加密）：{e}") from e

    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception:
            raise ParseError("PDF 已加密，无法解析")

    pages: list[str] = []
    for p in reader.pages:
        try:
            pages.append(p.extract_text() or "")
        except Exception:
            pages.append("")
    text = "\n\n".join(pages).strip()
    if not text:
        raise ParseError(
            "未能从 PDF 中提取到文字。这通常是扫描件（图片型 PDF），"
            "需要 OCR 才能处理，当前版本不支持。"
        )
    return text, {"pages": len(reader.pages)}


def extract_article_text(path: Path) -> tuple[str, dict]:
    ext = path.suffix.lower()
    if ext in SUPPORTED_PDF_EXT:
        return _read_pdf(path)
    if ext in SUPPORTED_ARTICLE_EXT:
        text = _read_text_file(path).strip()
        if not text:
            raise ParseError("文件内容为空")
        return text, {}
    raise ParseError(f"不支持的文件类型：{ext}（支持 .txt / .md / .pdf）")


def guess_kind(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in SUPPORTED_VIDEO_EXT:
        return "video"
    if ext in SUPPORTED_ARTICLE_EXT | SUPPORTED_PDF_EXT:
        return "article"
    return "unknown"
