"""LLM 输出的结构化字段规整（摘要 JSON 里的 review / notes 等）。

模型返回的嵌套结构经常变形（字符串、缺字段、多套一层），
统一在这里收敛成前端可直接渲染的形状，避免各 service 各写一份。
"""
from __future__ import annotations


def normalize_text(data: dict, field: str, limit: int = 1200) -> None:
    """把字段规整成字符串（None -> ""，超长截断）"""
    val = data.get(field)
    data[field] = str(val).strip()[:limit] if val else ""


def normalize_notes(
    data: dict,
    field: str = "notes",
    *,
    max_sections: int = 6,
    max_points: int = 8,
    point_len: int = 140,
) -> None:
    """规整「知识笔记」：统一为 [{"title": str, "points": [str, ...]}]。

    兼容模型的多种写法：
    - {"title": "..", "points": [..]} / {"title": "..", "items": [..]}
    - {"title": "..", "content": "整段文字"}  → 折成单条 points
    - 纯字符串 / 纯列表
    空小节（没有 points）会被丢弃。
    """
    raw = data.get(field)
    if not isinstance(raw, list):
        data[field] = []
        return

    out: list[dict] = []

    def push(title: str, points: list) -> None:
        pts = [str(p).strip()[:point_len] for p in points if str(p).strip()][:max_points]
        if not pts:
            return
        out.append({"title": str(title or "").strip()[:40], "points": pts})

    for item in raw[:max_sections]:
        if isinstance(item, dict):
            title = item.get("title") or item.get("name") or item.get("heading") or ""
            pts = item.get("points") or item.get("items") or item.get("bullets") or []
            if isinstance(pts, str):
                pts = [pts]
            if not isinstance(pts, list):
                pts = []
            if not pts:
                body = item.get("content") or item.get("text") or ""
                pts = [ln.strip(" -•\t") for ln in str(body).splitlines() if ln.strip()] or (
                    [body] if str(body).strip() else []
                )
            push(title, pts)
        elif isinstance(item, str) and item.strip():
            push("", [item.strip()[:600]])

    for i, n in enumerate(out, 1):
        if not n["title"]:
            n["title"] = f"笔记 {i}"
    data[field] = out
