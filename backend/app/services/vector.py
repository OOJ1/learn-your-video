"""ChromaDB 向量库封装：字幕块 + 时间戳 metadata 的写入与检索。"""
from __future__ import annotations

import logging

from app.config import get_settings
from app.core.embeddings import get_embedder

logger = logging.getLogger("app.vector")


class VectorStoreError(RuntimeError):
    pass


class VectorStore:
    def __init__(self):
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings
        except ImportError as e:
            raise VectorStoreError("未安装 chromadb，请执行 pip install chromadb") from e

        s = get_settings()
        try:
            self._client = chromadb.PersistentClient(
                path=str(s.chroma_path),
                settings=ChromaSettings(anonymized_telemetry=False),
            )
            self._col = self._client.get_or_create_collection(
                name=s.CHROMA_COLLECTION,
                metadata={"hnsw:space": "cosine"},
            )
        except Exception as e:
            raise VectorStoreError(f"ChromaDB 初始化失败：{e}") from e

    def add_chunks(self, doc_id: str, chunks: list[dict]) -> int:
        """chunks: [{"text":str, "start":float, "end":float, "index":int}, ...]"""
        if not chunks:
            return 0
        texts = [c["text"] for c in chunks]
        ids = [f"{doc_id}#{c['index']}" for c in chunks]
        metas = [{
            "doc_id": doc_id,
            "start": float(c.get("start", 0.0)),
            "end": float(c.get("end", 0.0)),
            "index": int(c.get("index", i)),
        } for i, c in enumerate(chunks)]

        emb = get_embedder().embed_documents(texts)
        self._col.upsert(ids=ids, documents=texts, embeddings=emb, metadatas=metas)
        return len(chunks)

    def query(self, text: str, top_k: int = 4, doc_id: str | None = None,
              threshold: float = 0.0) -> list[dict]:
        q = get_embedder().embed_query(text)
        kwargs = {
            "query_embeddings": [q],
            "n_results": max(1, top_k),
            "include": ["documents", "metadatas", "distances"],
        }
        if doc_id:
            kwargs["where"] = {"doc_id": doc_id}

        res = self._col.query(**kwargs)
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]

        out = []
        for d, m, dist in zip(docs, metas, dists):
            # cosine 空间下 chroma 返回 cosine distance，转成相似度
            score = 1.0 - float(dist)
            if score < threshold:
                continue
            out.append({"text": d, "metadata": m or {}, "score": round(score, 4)})
        return out

    def delete_doc(self, doc_id: str) -> int:
        """删除该文档的全部向量，返回删除条数。

        这里曾写成 `except Exception: pass`，异常被静默吞掉会留下
        「记录已删、向量还在」的孤儿数据（本次巡检查出 2 个），
        结果是已删除的视频仍能被问答检索到。改为：先按 doc_id 取回 id 再删，
        失败记日志并上抛，由调用方决定如何处理。
        """
        try:
            got = self._col.get(where={"doc_id": doc_id}, include=["metadatas"])
            ids = list(got.get("ids") or [])
            if ids:
                self._col.delete(ids=ids)
            logger.info("已删除向量 doc=%s chunks=%d", doc_id, len(ids))
            return len(ids)
        except Exception as e:
            logger.warning("删除向量失败 doc=%s: %s", doc_id, e)
            raise

    def doc_ids(self) -> dict[str, int]:
        """返回 {doc_id: 块数}，用于巡检「记录已删但向量残留」的孤儿数据。"""
        try:
            got = self._col.get(include=["metadatas"])
        except Exception as e:
            logger.warning("统计向量失败: %s", e)
            return {}
        out: dict[str, int] = {}
        for m in got.get("metadatas") or []:
            if not m:
                continue
            did = str(m.get("doc_id", "?"))
            out[did] = out.get(did, 0) + 1
        return out

    def count(self) -> int:
        try:
            return self._col.count()
        except Exception:
            return 0


_vs: VectorStore | None = None


def get_vector_store(force: bool = False) -> VectorStore:
    global _vs
    if _vs is None or force:
        _vs = VectorStore()
    return _vs
