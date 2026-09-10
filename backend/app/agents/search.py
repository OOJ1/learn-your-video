"""联网搜索：Tavily 优先，失败/无 Key 自动降级 DuckDuckGo。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    engine: str


class SearchError(RuntimeError):
    pass


def _tavily(query: str, n: int, api_key: str) -> list[SearchResult]:
    from tavily import TavilyClient

    data = TavilyClient(api_key=api_key).search(query=query, max_results=n)
    return [SearchResult(r.get("title", ""), r.get("url", ""),
                         r.get("content", ""), "tavily") for r in data.get("results", [])]


def _duckduckgo(query: str, n: int) -> list[SearchResult]:
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS  # 旧包名

    with DDGS() as d:
        items = d.text(query, max_results=n) or []
    return [SearchResult(i.get("title", ""), i.get("href") or i.get("url", ""),
                         i.get("body") or i.get("snippet", ""), "duckduckgo") for i in items]


def web_search(query: str, max_results: int | None = None) -> tuple[list[SearchResult], str]:
    """返回 (结果列表, 实际使用的引擎)。auto 模式下 Tavily 失败会降级到 DuckDuckGo。"""
    from app.config import get_settings

    s = get_settings()
    n = max_results or s.SEARCH_MAX_RESULTS
    provider = (s.SEARCH_PROVIDER or "auto").lower().strip()

    if provider == "off":
        return [], "off"
    if provider == "tavily":
        order = ["tavily"]
    elif provider in ("duckduckgo", "ddg"):
        order = ["duckduckgo"]
    else:  # auto
        order = ["tavily", "duckduckgo"] if s.TAVILY_API_KEY else ["duckduckgo"]

    errors: list[str] = []
    for p in order:
        try:
            if p == "tavily":
                if not s.TAVILY_API_KEY:
                    errors.append("tavily: 未配置 TAVILY_API_KEY")
                    continue
                return _tavily(query, n, s.TAVILY_API_KEY), "tavily"
            return _duckduckgo(query, n), "duckduckgo"
        except Exception as e:
            errors.append(f"{p}: {type(e).__name__}: {e}")

    raise SearchError("全部搜索引擎均失败 -> " + " | ".join(errors))
