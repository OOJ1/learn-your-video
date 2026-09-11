"""统一 LLM 抽象层：Ollama 与 OpenAI 兼容云端共用同一套 OpenAI SDK，仅切换 base_url。"""
from __future__ import annotations

import json
import logging
import re
from typing import Iterator

import httpx
from openai import OpenAI

from app.config import Settings, get_settings

logger = logging.getLogger("app.llm")


class LLMError(RuntimeError):
    pass


class BaseLLM:
    provider = "base"
    model = ""

    def chat(self, messages: list[dict], temperature: float | None = None,
             max_tokens: int | None = None) -> str:
        raise NotImplementedError

    def stream(self, messages: list[dict], temperature: float | None = None,
               max_tokens: int | None = None) -> Iterator[str]:
        raise NotImplementedError

    def list_models(self) -> list[str]:
        return []

    def health(self) -> dict:
        return {"provider": self.provider, "model": self.model, "ok": False}


class OpenAICompatLLM(BaseLLM):
    """DeepSeek / 通义 / 智谱 / OpenAI 等所有 OpenAI 兼容端点"""

    def __init__(self, settings: Settings, trust_env: bool = True):
        self.s = settings
        self.provider = "openai"
        self.model = settings.OPENAI_MODEL
        key = (settings.OPENAI_API_KEY or "").strip()
        if not key or key.startswith("sk-REPLACE") or not key.isascii():
            raise LLMError(
                "OPENAI_API_KEY 未正确配置（当前为空、占位符或含非 ASCII 字符）。"
                "请在 backend/.env 中填入真实的 DeepSeek Key，例如 OPENAI_API_KEY=sk-xxxx"
            )
        self.client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
            timeout=httpx.Timeout(180.0, connect=15.0),
            max_retries=2,
            http_client=httpx.Client(trust_env=trust_env),
        )

    def chat(self, messages, temperature=None, max_tokens=None) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.s.OPENAI_TEMPERATURE if temperature is None else temperature,
            max_tokens=self.s.OPENAI_MAX_TOKENS if max_tokens is None else max_tokens,
        )
        return (resp.choices[0].message.content or "").strip()

    def stream(self, messages, temperature=None, max_tokens=None) -> Iterator[str]:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.s.OPENAI_TEMPERATURE if temperature is None else temperature,
            max_tokens=self.s.OPENAI_MAX_TOKENS if max_tokens is None else max_tokens,
            stream=True,
        )
        for chunk in resp:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def list_models(self) -> list[str]:
        try:
            return sorted(m.id for m in self.client.models.list().data)
        except Exception as e:
            raise LLMError(
                f"无法拉取 {self.s.OPENAI_BASE_URL} 的模型列表：{type(e).__name__}: {e}"
                "（检查 OPENAI_API_KEY 是否正确、网络是否可达）"
            ) from e

    def health(self) -> dict:
        try:
            models = self.list_models()
            return {"provider": self.provider, "model": self.model,
                    "base_url": self.s.OPENAI_BASE_URL, "ok": True, "models": models[:20]}
        except Exception as e:
            return {"provider": self.provider, "model": self.model,
                    "ok": False, "error": f"{type(e).__name__}: {e}"}


class OllamaLLM(BaseLLM):
    """本地 Ollama：走原生 /api/chat 端点。

    不用 /v1 兼容端点的原因：qwen3.x 这类推理模型在 /v1 下会把 num_predict 额度
    全部消耗在 reasoning 上，导致最终 content 为空；原生端点支持 think=False，
    可直接输出答案（实测 0.9s vs 46.7s 且仍为空）。
    """

    def __init__(self, settings: Settings):
        self.s = settings
        self.provider = "ollama"
        self.model = settings.OLLAMA_MODEL
        self._base = settings.OLLAMA_BASE_URL.replace("/v1", "").rstrip("/")
        # 本地地址必须绕过系统代理，否则 127.0.0.1 会被代理拦截
        self._c = httpx.Client(timeout=httpx.Timeout(600.0, connect=10.0), trust_env=False)

    def _payload(self, messages, temperature, max_tokens, stream=False) -> dict:
        return {
            "model": self.model,
            "messages": messages,
            "stream": stream,
            "think": bool(self.s.OLLAMA_THINK),
            "options": {
                "temperature": self.s.OPENAI_TEMPERATURE if temperature is None else temperature,
                "num_predict": self.s.OLLAMA_MAX_TOKENS if max_tokens is None else max_tokens,
                # 必须显式指定：Ollama 默认上下文仅 4k，长字幕会把窗口占满，
                # 输出被硬截断后 JSON 必然非法（且 done_reason=length）。
                "num_ctx": self.s.OLLAMA_NUM_CTX,
            },
        }

    @staticmethod
    def _extract(msg: dict) -> str:
        content = (msg.get("content") or "").strip()
        if content:
            return content
        reasoning = (msg.get("reasoning") or "").strip()
        raise LLMError(
            "模型只产出了思考内容、未给出正式答案（常见于 qwen3.x 等推理模型）。"
            "请在 .env 中设置 OLLAMA_THINK=False，或调大 OLLAMA_MAX_TOKENS。"
            f"本次思考已产出 {len(reasoning)} 字。"
        )

    def _post(self, payload: dict):
        try:
            r = self._c.post(f"{self._base}/api/chat", json=payload)
            r.raise_for_status()
            return r
        except httpx.ConnectError as e:
            raise LLMError(
                f"无法连接 Ollama（{self._base}）：{e}。"
                "请先执行 `ollama serve` 让服务常驻（Windows 上运行一次 `ollama list` 也会拉起）"
            ) from e
        except httpx.HTTPStatusError as e:
            raise LLMError(f"Ollama 返回错误 {e.response.status_code}: {e.response.text[:300]}") from e

    def chat(self, messages, temperature=None, max_tokens=None) -> str:
        data = self._post(self._payload(messages, temperature, max_tokens)).json()
        # done_reason=length 说明是撞到 num_predict 上限被硬截断，
        # 这种输出必然不是完整 JSON，直接报错比让上层解析失败更好定位
        if data.get("done_reason") == "length":
            limit = self.s.OLLAMA_MAX_TOKENS if max_tokens is None else max_tokens
            raise LLMError(
                f"模型输出被截断（num_predict 上限 {limit}），JSON 不完整。"
                "请调大 .env 的 OLLAMA_MAX_TOKENS 或减少要求输出的条目数"
            )
        return self._extract(data.get("message", {}))

    def stream(self, messages, temperature=None, max_tokens=None) -> Iterator[str]:
        payload = self._payload(messages, temperature, max_tokens, stream=True)
        try:
            with self._c.stream("POST", f"{self._base}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("done"):
                        break
                    piece = (data.get("message") or {}).get("content") or ""
                    if piece:
                        yield piece
        except httpx.ConnectError as e:
            raise LLMError(f"无法连接 Ollama（{self._base}）：{e}") from e

    def list_models(self) -> list[str]:
        try:
            r = self._c.get(f"{self._base}/api/tags")
            r.raise_for_status()
            return sorted(m["name"] for m in r.json().get("models", []))
        except Exception as e:
            raise LLMError(
                f"无法连接 Ollama（{self._base}）：{e}。请先执行 `ollama serve`"
            ) from e

    def health(self) -> dict:
        try:
            models = self.list_models()
            return {"provider": self.provider, "model": self.model, "ok": True,
                    "models": models, "think": self.s.OLLAMA_THINK}
        except Exception as e:
            return {"provider": self.provider, "model": self.model, "ok": False, "error": str(e)}


_llm: BaseLLM | None = None


def get_llm(force: bool = False) -> BaseLLM:
    global _llm
    if _llm is not None and not force:
        return _llm
    s = get_settings()
    p = s.LLM_PROVIDER.lower().strip()
    if p == "ollama":
        _llm = OllamaLLM(s)
    elif p in ("openai", "deepseek", "cloud"):
        _llm = OpenAICompatLLM(s)
    else:
        raise LLMError(f"未知 LLM_PROVIDER: {p}（可选 openai / ollama）")
    return _llm


_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def _repair_inner_quotes(txt: str) -> str:
    """修复字符串值内未转义的英文双引号（LLM 常见输出瑕疵）。

    逐字符扫描：处于字符串内时，遇到 `"` 后看下一个非空白字符——
    是结构字符（, } ] :）则视为字符串正常闭合，否则视为内容引号并转义。
    """
    out: list[str] = []
    in_str = esc = False
    n = len(txt)
    i = 0
    while i < n:
        c = txt[i]
        if not in_str:
            if c == '"':
                in_str = True
            out.append(c)
            i += 1
            continue
        if esc:
            esc = False
            out.append(c)
            i += 1
            continue
        if c == "\\":
            esc = True
            out.append(c)
            i += 1
            continue
        if c == '"':
            j = i + 1
            while j < n and txt[j] in " \t\r\n":
                j += 1
            nxt = txt[j] if j < n else ""
            if nxt in ",}]:":  # 真正的字符串结尾
                in_str = False
                out.append(c)
            else:  # 内容里的引号 → 转义
                out.append('\\"')
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _repair_control_chars(txt: str) -> str:
    """转义字符串值内的裸控制字符（换行 / 制表符）。

    LLM 写长文本（如 200 字的评价、多行笔记）时常在字符串里直接换行，
    这是 JSON 非法的最常见原因之一（Unterminated string）。
    """
    out: list[str] = []
    in_str = esc = False
    for c in txt:
        if not in_str:
            if c == '"':
                in_str = True
            out.append(c)
            continue
        if esc:
            esc = False
            out.append(c)
            continue
        if c == "\\":
            esc = True
            out.append(c)
            continue
        if c == '"':
            in_str = False
            out.append(c)
        elif c == "\n":
            out.append("\\n")
        elif c == "\r":
            out.append("\\r")
        elif c == "\t":
            out.append("\\t")
        elif ord(c) < 0x20:
            out.append(" ")
        else:
            out.append(c)
    return "".join(out)


def chat_json(llm: BaseLLM, messages: list[dict], default: dict | None = None,
              max_tokens: int | None = None) -> dict:
    """让 LLM 返回 JSON，容错剥离 markdown 代码块并修复常见格式瑕疵"""
    raw = llm.chat(messages, temperature=0.0, max_tokens=max_tokens)
    txt = raw.strip()
    m = _JSON_FENCE.search(txt)
    if m:
        txt = m.group(1).strip()
    start, end = txt.find("{"), txt.rfind("}")
    if start != -1 and end > start:
        txt = txt[start:end + 1]

    # 依次尝试：原文 → 修内层引号 → 修裸换行 → 两种修复叠加
    # （顺序不固定，两种修复互有干扰，全试一遍最稳）
    variants = [
        txt,
        _repair_inner_quotes(txt),
        _repair_control_chars(txt),
        _repair_control_chars(_repair_inner_quotes(txt)),
        _repair_inner_quotes(_repair_control_chars(txt)),
    ]
    for v in variants:
        try:
            return json.loads(v)
        except Exception:
            continue

    logger.warning("LLM 返回的 JSON 无法解析（前 200 字）：%s", raw[:200])
    if default is not None:
        return default
    raise LLMError(f"LLM 未返回合法 JSON：{raw[:300]}")
