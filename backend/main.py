import collections
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.rag.generate import GenerationError
from backend.rag.pipeline import answer


@asynccontextmanager
async def lifespan(app):
    """Load the vectors and the embedding model once at start-up so the first question is not slow."""
    if os.environ.get("CHAMBERS_PRELOAD", "1") == "1":
        from backend.rag.retrieve import retrieve
        retrieve("warm up", "criminal", k=1)
    yield


app = FastAPI(title="ChambersAI", lifespan=lifespan)
# The frontend (e.g. a Hugging Face static Space) runs on another origin: list it in CHAMBERS_ALLOWED_ORIGINS,
# comma separated, e.g. "https://youruser-chambersai.static.hf.space". Never use "*" with real client data.
ORIGINS = [o.strip() for o in os.environ.get("CHAMBERS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())

# Tiny per-IP limiter so one visitor cannot burn the Gemini quota (2 calls per question).
RATE_LIMIT = int(os.environ.get("CHAMBERS_RATE_LIMIT", "20"))      # questions per minute per IP
_recent = collections.defaultdict(list)


def check_rate(request: Request):
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "?")
    now = time.time()
    _recent[ip] = [t for t in _recent[ip] if now - t < 60]
    if len(_recent[ip]) >= RATE_LIMIT:
        raise HTTPException(429, "too many questions, please wait a minute")
    _recent[ip].append(now)


class AskRequest(BaseModel):
    lawyer: str
    question: str
    lang: Optional[str] = None      # "en" | "hi"; detected from the question when omitted


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/lawyers")
def lawyers():
    return LAWYERS


@app.post("/ask")
def ask(req: AskRequest, request: Request):
    check_rate(request)
    lawyer = next((l for l in LAWYERS if l["id"] == req.lawyer), None)
    if lawyer is None:
        raise HTTPException(404, "unknown lawyer")
    try:
        return answer(req.question, lawyer, req.lang)
    except GenerationError as e:
        raise HTTPException(503, str(e))
