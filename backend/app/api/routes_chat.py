"""问答路由：非流式 + SSE 流式 + 历史管理。"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.qa import QAError, answer, stream_answer
from app.core.llm import LLMError
from app.services.store import get_store

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatIn(BaseModel):
    doc_id: str
    question: str = Field(min_length=1, max_length=2000)
    use_web: str = "auto"  # auto / on / off


@router.post("")
def chat(body: ChatIn):
    store = get_store()
    if not store.get_doc(body.doc_id):
        raise HTTPException(404, "文档不存在")
    if body.use_web not in ("auto", "on", "off"):
        raise HTTPException(400, "use_web 只能是 auto / on / off")
    try:
        return answer(body.doc_id, body.question, body.use_web)
    except QAError as e:
        raise HTTPException(400, str(e))
    except LLMError as e:
        # LLM 不可用时不让前端拿到 500，给可读提示
        return {"ok": False, "error": str(e), "answer": "", "refs": []}


@router.post("/stream")
def chat_stream(body: ChatIn):
    store = get_store()
    if not store.get_doc(body.doc_id):
        raise HTTPException(404, "文档不存在")

    def gen():
        try:
            for ev in stream_answer(body.doc_id, body.question, body.use_web):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except (QAError, LLMError) as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': f'{type(e).__name__}: {e}'}, ensure_ascii=False)}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@router.get("/{doc_id}/history")
def history(doc_id: str, limit: int = 50):
    return {"ok": True, "items": get_store().get_history(doc_id, limit=limit)}


@router.delete("/{doc_id}/history")
def clear_history(doc_id: str):
    get_store().clear_history(doc_id)
    return {"ok": True}
