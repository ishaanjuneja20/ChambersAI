import json
import os
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from backend.rag.generate import GenerationError
from backend.rag.pipeline import answer, warmup

app = FastAPI(title="ChambersAI")
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())


class AskRequest(BaseModel):
    lawyer: str
    question: str
    lang: Optional[str] = None      # "en" | "hi"; detected from the question when omitted


@app.on_event("startup")
def _warm():
    if os.environ.get("CHAMBERS_WARMUP", "1") != "0":
        warmup()


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/lawyers")
def lawyers():
    return LAWYERS


@app.post("/ask")
def ask(req: AskRequest):
    lawyer = next((l for l in LAWYERS if l["id"] == req.lawyer), None)
    if lawyer is None:
        raise HTTPException(404, "unknown lawyer")
    try:
        return answer(req.question, lawyer, req.lang)
    except GenerationError as e:
        raise HTTPException(503, str(e))
