import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings, reload_settings
from app.core.embeddings import get_embedder
from app.core.llm import get_llm

# app.* 下的 logger（如 app.video 的转写进度）统一输出到 stdout，
# 与 uvicorn 的 access log 一起落盘到 logs/backend.log（stderr 留给报错堆栈）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
for _noisy in ("httpx", "httpcore", "urllib3", "huggingface_hub", "faster_whisper"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

settings = get_settings()

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api.routes_articles import router as articles_router  # noqa: E402
from app.api.routes_chat import router as chat_router  # noqa: E402
from app.api.routes_grabber import router as grabber_router  # noqa: E402
from app.api.routes_videos import router as videos_router  # noqa: E402

app.include_router(articles_router)
app.include_router(videos_router)
app.include_router(chat_router)
app.include_router(grabber_router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "llm_provider": settings.LLM_PROVIDER,
        "embed_provider": settings.EMBED_PROVIDER,
        "search_provider": settings.SEARCH_PROVIDER,
    }


@app.get("/api/diagnose")
def diagnose():
    """逐项探测依赖可用性，前端启动时可据此提示用户"""
    out = {}
    for key, fn in (("llm", lambda: get_llm().health()),
                    ("embedding", lambda: get_embedder().health())):
        try:
            out[key] = fn()
        except Exception as e:
            out[key] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    try:
        import redis
        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=3)
        r.ping()
        out["redis"] = {"ok": True, "url": settings.REDIS_URL}
    except Exception as e:
        out["redis"] = {"ok": False, "url": settings.REDIS_URL,
                        "error": f"{type(e).__name__}: {e}"}
    return out


@app.get("/api/models")
def list_models():
    """列出当前 provider 可用模型，供前端下拉选择"""
    try:
        return {"ok": True, "models": get_llm().list_models()}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "models": []}


@app.get("/api/config")
def read_config():
    s = get_settings()
    return {
        "app_name": s.APP_NAME,
        "llm_provider": s.LLM_PROVIDER,
        "llm_model": s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL,
        "embed_provider": s.EMBED_PROVIDER,
        "embed_model": s.LOCAL_EMBED_MODEL if s.EMBED_PROVIDER == "local" else s.OPENAI_EMBED_MODEL,
        "search_provider": s.SEARCH_PROVIDER,
        "has_llm_key": bool(s.OPENAI_API_KEY) and not s.OPENAI_API_KEY.startswith("sk-REPLACE"),
        "has_tavily_key": bool(s.TAVILY_API_KEY),
        "video_top_k": s.VIDEO_TOP_K,
        "max_article_chars": s.MAX_ARTICLE_CHARS,
    }


class _ConfigPatch(BaseModel):
    patch: dict


@app.post("/api/config/save")
def save_config(body: _ConfigPatch):
    """设置中心保存：只允许改写白名单内的键，写回 .env 后立即生效"""
    from app.config import EDITABLE_KEYS, save_settings

    patch = {k: str(v) for k, v in (body.patch or {}).items() if k in EDITABLE_KEYS}
    dropped = [k for k in (body.patch or {}) if k not in EDITABLE_KEYS]
    save_settings(patch)
    s = get_settings()
    return {
        "ok": True,
        "saved": sorted(patch),
        "ignored": dropped,
        "llm_provider": s.LLM_PROVIDER,
        "llm_model": s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL,
        "search_provider": s.SEARCH_PROVIDER,
    }


@app.post("/api/config/reload")
def reload_config():
    s = reload_settings()
    # 与 read_config 保持一致：返回当前 provider 实际生效的模型
    model = s.OPENAI_MODEL if s.LLM_PROVIDER == "openai" else s.OLLAMA_MODEL
    return {"ok": True, "llm_provider": s.LLM_PROVIDER, "llm_model": model}
