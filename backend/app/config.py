from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---------- 应用 ----------
    APP_NAME: str = "你的学习搭子"
    DEBUG: bool = True
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # ---------- LLM ----------
    # openai = 任意 OpenAI 兼容云端(DeepSeek/通义/智谱/OpenAI)；ollama = 本地
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.deepseek.com/v1"
    OPENAI_MODEL: str = "deepseek-chat"
    OPENAI_TEMPERATURE: float = 0.3
    OPENAI_MAX_TOKENS: int = 4096

    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434/v1"
    OLLAMA_MODEL: str = "qwen3.5:9b"
    OLLAMA_API_KEY: str = "ollama"
    # qwen3.x 等推理模型默认会先"思考"，开启时 token 会被 reasoning 吃光导致答案为空。
    # 需要模型做复杂推理时改为 true，同时把 OLLAMA_MAX_TOKENS 调大到 4096+
    OLLAMA_THINK: bool = False
    OLLAMA_MAX_TOKENS: int = 2048

    # ---------- Embedding ----------
    # local = 本地 fastembed(ONNX, 无需 torch)；openai = 云端端点；ollama = 本地 Ollama
    EMBED_PROVIDER: str = "local"
    LOCAL_EMBED_MODEL: str = "BAAI/bge-small-zh-v1.5"
    LOCAL_EMBED_DIM: int = 512
    EMBED_BATCH_SIZE: int = 32
    # HuggingFace 镜像；留空则用官方源
    HF_ENDPOINT: str = "https://hf-mirror.com"
    OPENAI_EMBED_MODEL: str = ""
    OLLAMA_EMBED_MODEL: str = ""

    # ---------- 搜索 ----------
    # auto = Tavily 优先、失败降级 DuckDuckGo；tavily / duckduckgo = 指定；off = 关闭
    # 默认关闭联网搜索：需在设置中心配置 Tavily API Key 后手动开启
    SEARCH_PROVIDER: str = "off"
    TAVILY_API_KEY: str = ""
    SEARCH_MAX_RESULTS: int = 5

    # ---------- 存储 ----------
    REDIS_URL: str = "redis://127.0.0.1:6379/0"
    REDIS_TTL_SECONDS: int = 60 * 60 * 24 * 7
    DATA_DIR: str = "./data"
    CHROMA_DIR: str = "./data/chroma"
    CHROMA_COLLECTION: str = "study_buddy"

    # ---------- ASR ----------
    WHISPER_MODEL_SIZE: str = "small"
    WHISPER_DEVICE: str = "cpu"
    WHISPER_COMPUTE_TYPE: str = "int8"
    WHISPER_LANGUAGE: str = "zh"
    FFMPEG_PATH: str = ""

    # ---------- RAG ----------
    MAX_ARTICLE_CHARS: int = 24000
    VIDEO_TOP_K: int = 4
    SCORE_THRESHOLD: float = 0.30
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 80
    # 时间轴分段总结：每个片段的目标秒数与最大片段数
    VIDEO_SEGMENT_SECONDS: int = 150
    VIDEO_SEGMENT_MAX: int = 40

    @property
    def data_path(self) -> Path:
        p = Path(self.DATA_DIR)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def chroma_path(self) -> Path:
        p = Path(self.CHROMA_DIR)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reload_settings() -> Settings:
    """修改 .env 后热重载，供 /api/config 使用"""
    get_settings.cache_clear()
    return get_settings()


# 允许前端设置中心改写的字段（其余配置继续走手动编辑 .env）
EDITABLE_KEYS = {
    "LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
    "OLLAMA_BASE_URL", "OLLAMA_MODEL", "OLLAMA_API_KEY",
    "SEARCH_PROVIDER", "TAVILY_API_KEY",
}


def save_settings(patch: dict) -> dict:
    """把设置中心提交的字段写回 .env（保留其他行与注释），然后热重载"""
    env_path = BACKEND_DIR / ".env"
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else ""
        if key in patch:
            out.append(f"{key}={patch[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, val in patch.items():
        if key not in seen:
            out.append(f"{key}={val}")

    env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    reload_settings()
    return patch
