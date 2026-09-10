"""文档元数据 / 原文缓存 / 状态的存储层。

优先使用真实 Redis；连不上时自动降级为进程内内存实现（接口完全一致），
保证无 Redis 环境下应用也能完整跑通。切换只需改 .env 的 REDIS_URL。
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.config import get_settings


class DocStatus:
    UPLOADED = "uploaded"
    PARSING = "parsing"
    TRANSCRIBING = "transcribing"
    EMBEDDING = "embedding"
    SUMMARIZING = "summarizing"
    READY = "ready"
    FAILED = "failed"

    LABEL = {
        UPLOADED: "已上传",
        PARSING: "解析中",
        TRANSCRIBING: "语音转写中",
        EMBEDDING: "向量化中",
        SUMMARIZING: "生成摘要中",
        READY: "已完成",
        FAILED: "失败",
    }


def new_id(prefix: str = "doc") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> float:
    return time.time()


class BaseStore:
    backend = "base"

    def ping(self) -> bool:
        return False

    def save_doc(self, doc: dict) -> None:
        raise NotImplementedError

    def get_doc(self, doc_id: str) -> dict | None:
        raise NotImplementedError

    def delete_doc(self, doc_id: str) -> None:
        raise NotImplementedError

    def list_docs(self, doc_type: str | None = None) -> list[dict]:
        raise NotImplementedError

    def set_status(self, doc_id: str, status: str, progress: int = 0, message: str = "") -> None:
        raise NotImplementedError

    def set_text(self, doc_id: str, text: str) -> None:
        raise NotImplementedError

    def get_text(self, doc_id: str) -> str:
        raise NotImplementedError

    def append_message(self, doc_id: str, role: str, content: str, refs: list | None = None) -> None:
        raise NotImplementedError

    def get_history(self, doc_id: str, limit: int = 50) -> list[dict]:
        raise NotImplementedError

    def clear_history(self, doc_id: str) -> None:
        raise NotImplementedError


class MemoryStore(BaseStore):
    """进程内存储 + JSON 落盘。

    没有 Redis 时的兜底：内存保证速度，落盘保证重启不丢。
    否则会出现「ChromaDB 里还有向量、磁盘上还有文件，但列表空了」的孤儿数据。
    """

    backend = "memory"

    def __init__(self):
        from app.config import get_settings

        self._dir = get_settings().data_path / "store"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._docs: dict[str, dict] = self._load("docs.json")
        self._text: dict[str, str] = self._load("texts.json")
        self._chat: dict[str, list[dict]] = self._load("chat.json")

    def _load(self, name: str):
        p = self._dir / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                # 落盘文件损坏时不要让应用起不来，重命名后重建
                p.rename(p.with_suffix(".corrupt"))
        return {}

    def _dump(self) -> None:
        for name, data in (("docs.json", self._docs),
                           ("texts.json", self._text),
                           ("chat.json", self._chat)):
            (self._dir / name).write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def ping(self) -> bool:
        return True

    def save_doc(self, doc: dict) -> None:
        self._docs[doc["id"]] = dict(doc)
        self._dump()

    def get_doc(self, doc_id: str) -> dict | None:
        d = self._docs.get(doc_id)
        return dict(d) if d else None

    def delete_doc(self, doc_id: str) -> None:
        self._docs.pop(doc_id, None)
        self._text.pop(doc_id, None)
        self._chat.pop(doc_id, None)
        self._dump()

    def list_docs(self, doc_type: str | None = None) -> list[dict]:
        items = [dict(d) for d in self._docs.values()]
        if doc_type:
            items = [d for d in items if d.get("type") == doc_type]
        return sorted(items, key=lambda d: d.get("created_at", 0), reverse=True)

    def set_status(self, doc_id, status, progress=0, message=""):
        d = self._docs.get(doc_id)
        if d is None:
            return
        d.update(status=status, progress=progress,
                 message=message or DocStatus.LABEL.get(status, status),
                 updated_at=_now())
        self._dump()

    def set_text(self, doc_id, text):
        self._text[doc_id] = text
        self._dump()

    def get_text(self, doc_id):
        return self._text.get(doc_id, "")

    def append_message(self, doc_id, role, content, refs=None):
        self._chat.setdefault(doc_id, []).append(
            {"role": role, "content": content, "refs": refs or [], "ts": _now()}
        )
        self._dump()

    def get_history(self, doc_id, limit=50):
        return list(self._chat.get(doc_id, []))[-limit:]

    def clear_history(self, doc_id):
        self._chat.pop(doc_id, None)
        self._dump()


class RedisStore(BaseStore):
    backend = "redis"

    def __init__(self, url: str, ttl: int = 604800):
        import redis

        self._r = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=3)
        self._ttl = ttl

    def ping(self) -> bool:
        try:
            return bool(self._r.ping())
        except Exception:
            return False

    @staticmethod
    def _k(doc_id: str) -> str:
        return f"sb:doc:{doc_id}"

    def save_doc(self, doc: dict) -> None:
        key = self._k(doc["id"])
        self._r.set(key, json.dumps(doc, ensure_ascii=False), ex=self._ttl)
        self._r.zadd("sb:docs", {doc["id"]: doc.get("created_at", _now())})

    def get_doc(self, doc_id: str) -> dict | None:
        raw = self._r.get(self._k(doc_id))
        return json.loads(raw) if raw else None

    def delete_doc(self, doc_id: str) -> None:
        self._r.delete(self._k(doc_id), f"sb:text:{doc_id}", f"sb:chat:{doc_id}")
        self._r.zrem("sb:docs", doc_id)

    def list_docs(self, doc_type: str | None = None) -> list[dict]:
        ids = self._r.zrevrange("sb:docs", 0, -1)
        out = []
        for i in ids:
            d = self.get_doc(i)
            if not d:
                self._r.zrem("sb:docs", i)
                continue
            if doc_type and d.get("type") != doc_type:
                continue
            out.append(d)
        return out

    def set_status(self, doc_id, status, progress=0, message=""):
        d = self.get_doc(doc_id)
        if d is None:
            return
        d.update(status=status, progress=progress,
                 message=message or DocStatus.LABEL.get(status, status),
                 updated_at=_now())
        self.save_doc(d)

    def set_text(self, doc_id, text):
        self._r.set(f"sb:text:{doc_id}", text, ex=self._ttl)

    def get_text(self, doc_id):
        return self._r.get(f"sb:text:{doc_id}") or ""

    def append_message(self, doc_id, role, content, refs=None):
        self._r.rpush(f"sb:chat:{doc_id}",
                      json.dumps({"role": role, "content": content,
                                  "refs": refs or [], "ts": _now()}, ensure_ascii=False))
        self._r.expire(f"sb:chat:{doc_id}", self._ttl)

    def get_history(self, doc_id, limit=50):
        raw = self._r.lrange(f"sb:chat:{doc_id}", -limit, -1)
        return [json.loads(x) for x in raw]

    def clear_history(self, doc_id):
        self._r.delete(f"sb:chat:{doc_id}")


_store: BaseStore | None = None


def get_store(force: bool = False) -> BaseStore:
    global _store
    if _store is not None and not force:
        return _store
    s = get_settings()
    try:
        rs = RedisStore(s.REDIS_URL, s.REDIS_TTL_SECONDS)
        if rs.ping():
            _store = rs
            print(f"[store] 已连接 Redis: {s.REDIS_URL}")
        else:
            raise ConnectionError("ping 失败")
    except Exception as e:
        _store = MemoryStore()
        print(f"[store] Redis 不可用({type(e).__name__})，降级为「内存 + JSON 落盘」存储。"
              f"重启不丢数据，但仅限单进程；启动 redis-server 后重启本服务即自动切回 Redis。")
    return _store


def make_doc(filename: str, doc_type: str, **extra) -> dict:
    doc = {
        "id": new_id("a" if doc_type == "article" else "v"),
        "filename": filename,
        "type": doc_type,
        "status": DocStatus.UPLOADED,
        "progress": 0,
        "message": DocStatus.LABEL[DocStatus.UPLOADED],
        "created_at": _now(),
        "updated_at": _now(),
        "summary": None,
    }
    doc.update(extra)
    return doc
