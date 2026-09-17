"""联网搜索：Tavily 优先；未配置 Key 时整体不可用（由 web_search_status 统一判定）。

provider 语义：
  off        → 关闭，任何请求都不联网
  tavily     → 只用 Tavily（需 Key）
  auto（默认）→ 只用 Tavily（需 Key）；无 Key 视为不可用，不再降级 DuckDuckGo
  duckduckgo → 用户显式选择，无需 Key
"""
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


def web_search_status() -> tuple[bool, str]:
    """联网搜索当前**是否可用**，以及不可用时的原因（供前端锁定开关 + 悬停提示）。

    这是全链路唯一的判定源：前端按钮可用性、问答是否联网、设置中心状态文案，
    全部读这里，避免各处各判一套导致「看起来能点、点了没反应」。

    判定规则（与 web_search 的实际执行路径严格一致）：
      - off                → 不可用：设置里总开关关闭
      - duckduckgo / ddg   → 可用：用户显式选择，无需 Key
      - tavily             → 需配置 TAVILY_API_KEY
      - auto（默认值）      → 需配置 TAVILY_API_KEY
        以前 auto 无 Key 会静默降级 DuckDuckGo，但国内网络基本搜不通，
        表现为「点了联网却一条结果都没有」，比直接禁用更让人困惑，故改为明确禁用。
    """
    from app.config import get_settings

    s = get_settings()
    provider = (s.SEARCH_PROVIDER or "auto").lower().strip()

    if provider == "off":
        return False, "联网搜索已在设置中关闭，请到右上角设置中心开启"
    if provider in ("duckduckgo", "ddg"):
        return True, ""
    if not s.TAVILY_API_KEY:
        return False, "未配置联网搜索的 API Key（Tavily），请到右上角设置中心填写"
    return True, ""


def web_search(query: str, max_results: int | None = None) -> tuple[list[SearchResult], str]:
    """返回 (结果列表, 实际使用的引擎)。"""
    from app.config import get_settings

    s = get_settings()
    ok, why = web_search_status()
    if not ok:
        # 上层（qa.prepare）已提前拦截，这里兜住直接调用的情况，避免静默返回空结果
        raise SearchError(why)

    n = max_results or s.SEARCH_MAX_RESULTS
    provider = (s.SEARCH_PROVIDER or "auto").lower().strip()

    if provider == "tavily":
        order = ["tavily"]
    elif provider in ("duckduckgo", "ddg"):
        order = ["duckduckgo"]
    else:  # auto：此时必然有 Key（无 Key 已被上面的 status 拦掉），不再降级 DDG
        order = ["tavily"]

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
