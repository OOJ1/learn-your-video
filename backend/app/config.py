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
    OLLAMA_MAX_TOKENS: int = 4096
    # 摘要/评分这类结构化长输出单独给额度，避免被全局上限截断成非法 JSON
    SUMMARY_MAX_TOKENS: int = 4096
    # Ollama 默认上下文只有 4k，长字幕提示词会把窗口占满导致输出被硬截断。
    # 10240 是按「提示词 8k 字符 + 输出 4k token」留出的余量；
    # 内存充裕（32G+）可提到 16384 换取更好的长视频覆盖。
    OLLAMA_NUM_CTX: int = 10240
    # 单次送进模型的正文上限（超出取首+尾）。要小于 num_ctx 并给输出留足空间。
    SUMMARY_INPUT_CHARS: int = 8000

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
    # off 是总开关，会把前端「智能联网 / 强制联网」一起置灰；默认开启 auto
    SEARCH_PROVIDER: str = "auto"
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
    # cpu / cuda / auto。auto = 先看有没有可用的 NVIDIA GPU，有就用，并在首次加载时
    # 做一次真实自检；自检不通过（缺 cuBLAS/cuDNN、显存不足等）自动退回 CPU。
    # 长视频上 GPU 与 CPU 是数量级差距，但「有显卡」不等于「能跑」——ctranslate2 缺
    # 运行时库时是推理阶段才报错，所以这里必须实测而不是只看设备数。
    WHISPER_DEVICE: str = "auto"
    # 留空 = 按设备自动选（cuda → int8_float16，cpu → int8）
    WHISPER_COMPUTE_TYPE: str = ""
    # 额外的 CUDA 运行库目录（含 cublas64_12.dll 等）。
    # 留空时自动查找：venv 里的 nvidia-*-cu12 轮子 → 本机 Ollama 自带的 cuda_v12。
    WHISPER_CUDA_DLL_DIR: str = ""
    # 解码束宽：越大越准、越慢。CPU 上设 1 约省 1/3 时间，GPU 上影响很小。
    WHISPER_BEAM_SIZE: int = 5
    # auto/空 = 让 Whisper 自动检测语种（中英混合、纯英文视频必须用 auto）；
    # 填具体代码(zh/en/ja…)才会强制，强制错误语种会让转写被污染甚至产生幻觉文本。
    WHISPER_LANGUAGE: str = "auto"
    FFMPEG_PATH: str = ""

    # ---------- 视频画面识别（Vision）----------
    # 抽帧后交给视觉模型描述画面（幻灯片/图表/表格/屏幕文字/场景），再与字幕一起送进摘要，
    # 让总结同时覆盖「听到的」和「看到的」。
    #
    # 默认「跟随主模型」：VISION_PROVIDER 留空则用 LLM_PROVIDER，VISION_MODEL 留空则用该
    # provider 的主模型。只要主模型支持视觉（ollama 下的 qwen3.5 / qwen2.5vl / llava /
    # minicpm-v 等），无需任何额外配置即可开箱可用。
    # 想「文字用 A 模型、画面用 B 模型」时，显式设置下面两项即可（例如文字走 DeepSeek、
    # 画面走本地 Ollama 的视觉模型）。
    # 视觉模型不可用或调用失败时不会中断流程：自动降级为「仅字幕」摘要。
    VISION_ENABLED: bool = True
    VISION_PROVIDER: str = ""              # ollama | openai；空 = 跟随 LLM_PROVIDER
    VISION_MODEL: str = ""                 # 空 = 复用该 provider 的主模型（需支持视觉）
    VISION_BASE_URL: str = ""              # 空则复用 OLLAMA_BASE_URL / OPENAI_BASE_URL
    VISION_API_KEY: str = ""               # 空则复用 OLLAMA_API_KEY / OPENAI_API_KEY
    VISION_FRAME_INTERVAL: int = 30        # 目标抽帧间隔（秒），实际帧数受 VISION_MAX_FRAMES 限制
    VISION_MAX_FRAMES: int = 20            # 单视频最多分析帧数（控制耗时与成本）
    VISION_FRAME_WIDTH: int = 768          # 抽帧缩放宽度，越小越省 token
    VISION_BATCH: int = 4                  # 每次请求送几张画面
    VISION_MAX_TOKENS: int = 1500          # 单次画面描述的输出上限

    # ---------- RAG ----------
    MAX_ARTICLE_CHARS: int = 24000
    VIDEO_TOP_K: int = 4
    SCORE_THRESHOLD: float = 0.30
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 80

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
