"""Embedding 抽象层：本地 fastembed(ONNX, 免 torch) / 云端端点 / Ollama 三选一。"""
from __future__ import annotations

from typing import Iterable

import httpx
from openai import OpenAI

from app.config import Settings, get_settings
from app.core.hf import ensure_hf_env


class EmbeddingError(RuntimeError):
    pass


class BaseEmbedder:
    provider = "base"
    model = ""
    dim = 0

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]

    def health(self) -> dict:
        return {"provider": self.provider, "model": self.model, "dim": self.dim, "ok": False}


class LocalEmbedder(BaseEmbedder):
    """fastembed + ONNX Runtime，CPU 即可，无需 torch"""

    def __init__(self, settings: Settings):
        ensure_hf_env()
        try:
            from fastembed import TextEmbedding
        except ImportError as e:
            raise EmbeddingError("未安装 fastembed，请执行 pip install fastembed") from e
        self.provider = "local"
        self.model = settings.LOCAL_EMBED_MODEL
        self.dim = settings.LOCAL_EMBED_DIM
        self._batch = settings.EMBED_BATCH_SIZE
        try:
            # 固化到项目 data/models，避免落在系统 Temp 被清理后重复下载
            cache_dir = settings.data_path / "models"
            cache_dir.mkdir(parents=True, exist_ok=True)
            self._m = TextEmbedding(model_name=self.model, cache_dir=str(cache_dir))
        except Exception as e:
            hint = ""
            if "huggingface" in str(e).lower() or "connection" in str(e).lower():
                hint = "（国内下载模型可先设置环境变量 HF_ENDPOINT=https://hf-mirror.com）"
            raise EmbeddingError(f"加载本地 embedding 模型失败：{e}{hint}") from e

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        texts = [t if t.strip() else " " for t in texts]
        out: list[list[float]] = []
        for i in range(0, len(texts), self._batch):
            for vec in self._m.embed(texts[i:i + self._batch]):
                out.append(vec.tolist())
        if not out:
            raise EmbeddingError("embedding 结果为空")
        self.dim = len(out[0])
        return out

    def health(self) -> dict:
        try:
            v = self.embed_query("健康检查")
            return {"provider": self.provider, "model": self.model,
                    "dim": len(v), "ok": True}
        except Exception as e:
            return {"provider": self.provider, "model": self.model,
                    "ok": False, "error": f"{type(e).__name__}: {e}"}


class OpenAICompatEmbedder(BaseEmbedder):
    def __init__(self, settings: Settings, provider: str = "openai"):
        self.provider = provider
        if provider == "ollama":
            self.model = settings.OLLAMA_EMBED_MODEL
            base, key, trust = settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY, False
        else:
            self.model = settings.OPENAI_EMBED_MODEL
            base, key, trust = settings.OPENAI_BASE_URL, settings.OPENAI_API_KEY, True
        if not self.model:
            raise EmbeddingError(
                f"使用 {provider} embedding 但未配置模型名"
                f"（{'OLLAMA_EMBED_MODEL' if provider == 'ollama' else 'OPENAI_EMBED_MODEL'}）"
            )
        self._c = OpenAI(api_key=key, base_url=base, timeout=httpx.Timeout(120.0, connect=15.0),
                         http_client=httpx.Client(trust_env=trust))
        self.dim = settings.LOCAL_EMBED_DIM

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        texts = [t if t.strip() else " " for t in texts]
        out: list[list[float]] = []
        for i in range(0, len(texts), 32):
            r = self._c.embeddings.create(model=self.model, input=texts[i:i + 32])
            out.extend(d.embedding for d in r.data)
        if out:
            self.dim = len(out[0])
        return out

    def health(self) -> dict:
        try:
            v = self.embed_query("健康检查")
            return {"provider": self.provider, "model": self.model, "dim": len(v), "ok": True}
        except Exception as e:
            return {"provider": self.provider, "model": self.model,
                    "ok": False, "error": f"{type(e).__name__}: {e}"}


_embedder: BaseEmbedder | None = None


def get_embedder(force: bool = False) -> BaseEmbedder:
    global _embedder
    if _embedder is not None and not force:
        return _embedder
    s = get_settings()
    p = s.EMBED_PROVIDER.lower().strip()
    if p == "local":
        _embedder = LocalEmbedder(s)
    elif p in ("openai", "deepseek", "cloud"):
        _embedder = OpenAICompatEmbedder(s, "openai")
    elif p == "ollama":
        _embedder = OpenAICompatEmbedder(s, "ollama")
    else:
        raise EmbeddingError(f"未知 EMBED_PROVIDER: {p}（可选 local / openai / ollama）")
    return _embedder


def cosine(a: Iterable[float], b: Iterable[float]) -> float:
    va, vb = list(a), list(b)
    dot = sum(x * y for x, y in zip(va, vb))
    na = sum(x * x for x in va) ** 0.5
    nb = sum(x * x for x in vb) ** 0.5
    return dot / (na * nb) if na and nb else 0.0
