import json
import os
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.limits import MAX_QUESTION_CHARS, RateLimiter, check_question, client_ip
from backend.rag.generate import GenerationError
from backend.rag.pipeline import answer, answer_stream, warmup

app = FastAPI(title="ChambersAI")
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())

# The frontend runs on another origin than the tunnel: list it (comma separated) in CHAMBERS_ALLOWED_ORIGINS, for
# example "https://chambersai.pages.dev". Never "*": client data is sent to this API.
ORIGINS = [o.strip() for o in os.environ.get(
    "CHAMBERS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

LIMITER = RateLimiter(per_visitor=int(os.environ.get("CHAMBERS_RATE_LIMIT", "10")),      # questions a minute per visitor
                      overall=int(os.environ.get("CHAMBERS_RATE_LIMIT_ALL", "0")))       # all visitors together; 0 = off
MAX_CHARS = int(os.environ.get("CHAMBERS_MAX_QUESTION", str(MAX_QUESTION_CHARS)))
TRUST_PROXY = os.environ.get("CHAMBERS_TRUST_PROXY") == "1"


class AskRequest(BaseModel):
    lawyer: str
    question: str
    lang: Optional[str] = None      # "en" | "hi"; detected from the question when omitted
    voice: bool = True              # /ask/stream only: ask for a short answer that sounds right when spoken


@app.on_event("startup")
def _warm():
    if os.environ.get("CHAMBERS_WARMUP", "1") != "0":
        warmup()


def _gate(req: AskRequest, request: Request) -> dict:
    """404 unknown lawyer, 413/422 bad question, 429 too many questions; else the lawyer."""
    lawyer = next((l for l in LAWYERS if l["id"] == req.lawyer), None)
    if lawyer is None:
        raise HTTPException(404, "unknown lawyer")
    bad = check_question(req.question, MAX_CHARS)
    if bad:
        raise HTTPException(*bad)
    if not LIMITER.allow(client_ip(request.headers, request.client.host if request.client else None, TRUST_PROXY)):
        raise HTTPException(429, "too many questions, please wait a minute", headers={"Retry-After": "30"})
    return lawyer


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/lawyers")
def lawyers():
    return LAWYERS


@app.post("/ask")
def ask(req: AskRequest, request: Request):
    lawyer = _gate(req, request)
    try:
        return answer(req.question, lawyer, req.lang)
    except GenerationError as e:
        raise HTTPException(503, str(e))


@app.post("/ask/stream")
def ask_stream(req: AskRequest, request: Request):
    """Server-sent events, one JSON object per `data:` line: sentence / done / refused / error (see docs/CONTRACTS.md)."""
    lawyer = _gate(req, request)

    def events():
        for ev in answer_stream(req.question, lawyer, req.lang, voice=req.voice):
            yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
