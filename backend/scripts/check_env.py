"""环境自检：LLM / Embedding / Redis / FFmpeg 逐项探测。
用法: python scripts/check_env.py
"""
import os
import shutil
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402

OK, FAIL, WARN = "[ OK ]", "[FAIL]", "[WARN]"


def line(tag, name, msg):
    print(f"{tag} {name:<14} {msg}")


def check_redis(s):
    try:
        import redis
        c = redis.Redis.from_url(s.REDIS_URL, socket_connect_timeout=3, decode_responses=True)
        c.ping()
        line(OK, "Redis", f"{s.REDIS_URL} 连通")
        return True
    except Exception as e:
        line(FAIL, "Redis", f"{s.REDIS_URL} 不可用 -> {type(e).__name__}: {e}")
        line(WARN, "Redis", "请启动 redis-server（WSL/Docker/Memurai 均可）后重试")
        return False


def check_llm(s):
    from app.core.llm import LLMError, get_llm
    try:
        llm = get_llm(force=True)
        h = llm.health()
        if h.get("ok"):
            line(OK, "LLM", f"{h['provider']} / {h['model']}  可用模型数={len(h.get('models', []))}")
        else:
            line(FAIL, "LLM", f"{h['provider']} / {h['model']} -> {h.get('error')}")
        return h.get("ok", False)
    except LLMError as e:
        line(FAIL, "LLM", str(e))
        return False
    except Exception as e:
        line(FAIL, "LLM", f"{type(e).__name__}: {e}")
        return False


def check_embed(s):
    from app.core.embeddings import EmbeddingError, get_embedder
    try:
        emb = get_embedder(force=True)
        h = emb.health()
        if h.get("ok"):
            line(OK, "Embedding", f"{h['provider']} / {h['model']}  维度={h['dim']}")
            a = emb.embed_query("人工智能")
            b = emb.embed_query("机器学习")
            c = emb.embed_query("今天天气不错")
            from app.core.embeddings import cosine
            line(OK, "Embedding", f"语义相似度自检: AI vs 机器学习={cosine(a, b):.3f}  AI vs 天气={cosine(a, c):.3f}")
        else:
            line(FAIL, "Embedding", str(h.get("error")))
        return h.get("ok", False)
    except EmbeddingError as e:
        line(FAIL, "Embedding", str(e))
        return False


def check_ffmpeg(s):
    p = s.FFMPEG_PATH or shutil.which("ffmpeg")
    if p and Path(p).exists():
        line(OK, "FFmpeg", p)
        return True
    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        line(OK, "FFmpeg", f"回退到 imageio-ffmpeg 内置: {p}")
        return True
    except Exception:
        line(WARN, "FFmpeg", "未找到，将在 P3 视频模块安装前处理（pip install imageio-ffmpeg）")
        return False


def check_port(host, port, name):
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect((host, port))
        line(OK, name, f"{host}:{port} 开放")
        return True
    except Exception:
        line(WARN, name, f"{host}:{port} 未开放")
        return False
    finally:
        s.close()


def main():
    s = get_settings()
    print(f"=== 你的学习搭子 · 环境自检 ===")
    print(f"数据目录: {s.data_path}")
    print(f"LLM_PROVIDER={s.LLM_PROVIDER}  EMBED_PROVIDER={s.EMBED_PROVIDER}  SEARCH_PROVIDER={s.SEARCH_PROVIDER}")
    print()
    r1 = check_llm(s)
    r2 = check_embed(s)
    r3 = check_redis(s)
    check_ffmpeg(s)
    check_port("127.0.0.1", 11434, "Ollama")
    print()
    print("关键项：", "全部就绪" if (r1 and r2) else "存在失败项，按上面提示修复后重跑")


if __name__ == "__main__":
    main()
