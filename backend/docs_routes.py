"""Endpoints for uploaded PDFs (docs/CONTRACTS.md, "Document analysis"). Wired into backend/main.py with build_router().

POST   /sessions/{session_id}/documents          multipart field "file" (a text PDF) -> {doc_id, filename, pages, analysis}
DELETE /sessions/{session_id}/documents/{doc_id}
POST   /sessions/{session_id}/ask/stream         like POST /ask/stream, answers from the session's documents and the law
Storage, limits and privacy: backend/docs_store.py. Prompts and checks: backend/rag/docqa.py.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import docs_store
from backend.rag import docqa
from backend.rag.generate import GenerationError
from backend.rag.pipeline import answer_stream, sse_lines

logger = logging.getLogger(__name__)

# The multipart envelope adds a little to the 10 MB file; anything much bigger is turned away before it is read.
ENVELOPE_SLACK = 1024 * 1024


class SessionAskRequest(BaseModel):
    lawyer: str
    question: str
    lang: Optional[str] = None      # "en" | "hi"; detected from the question when omitted
    voice: bool = True              # asks for a short answer, about 90 words, that sounds right spoken


def _session(session_id: str) -> str:
    if not docs_store.valid_session_id(session_id):
        raise HTTPException(400, "Invalid session id.")
    return session_id


def build_router(lawyers: list[dict]) -> APIRouter:
    router = APIRouter()

    @router.post("/sessions/{session_id}/documents")
    def upload_document(session_id: str, request: Request, file: UploadFile = File(...), lang: Optional[str] = Form(None)):
        session_id = _session(session_id)
        if lang not in (None, "", "en", "hi"):
            raise HTTPException(422, "lang must be en or hi.")
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > docs_store.MAX_BYTES + ENVELOPE_SLACK:
            raise HTTPException(413, "The file is larger than 10 MB.")
        store = docs_store.get_store()
        try:
            with store.slot(session_id):                               # 409 when the session already has 3
                data = file.file.read(docs_store.MAX_BYTES + 1)
                filename = docs_store.clean_filename(file.filename)
                pages = docs_store.extract_pdf(data)                   # 413 / 400 / 422
                try:
                    analysis = docqa.analyze_document(pages, lang or None)   # the one Gemini call
                except GenerationError as e:
                    raise HTTPException(503, str(e)) from None         # nothing is stored when the analysis failed
                doc_id = store.add(session_id, filename, pages, analysis)
        except docs_store.DocError as e:
            raise HTTPException(e.status, e.message) from None
        finally:
            file.file.close()
        return {"doc_id": doc_id, "filename": filename, "pages": len(pages), "analysis": analysis}

    @router.delete("/sessions/{session_id}/documents/{doc_id}")
    def delete_document(session_id: str, doc_id: str):
        if not docs_store.get_store().delete(_session(session_id), doc_id):
            raise HTTPException(404, "unknown document")
        return {"deleted": True}

    @router.post("/sessions/{session_id}/ask/stream")
    def session_ask_stream(session_id: str, req: SessionAskRequest):
        """Server-sent events, the same four event types as POST /ask/stream. Without documents in the session it IS /ask/stream."""
        lawyer = next((l for l in lawyers if l["id"] == req.lawyer), None)
        if lawyer is None:
            raise HTTPException(404, "unknown lawyer")
        docs = docs_store.get_store().list_session(_session(session_id))

        def make_stream():
            if docs:
                return docqa.answer_stream_docs(req.question, lawyer, docs, req.lang, voice=req.voice)
            return answer_stream(req.question, lawyer, req.lang, voice=req.voice)

        def events():
            yield from sse_lines(make_stream)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return router
