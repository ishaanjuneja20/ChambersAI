import json
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

from backend.rag.retrieve import retrieve

app = FastAPI(title="ChambersAI")
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())
REFUSAL_THRESHOLD = 0.3  # tune on the test set


class AskRequest(BaseModel):
    lawyer: str
    question: str
    lang: str = "en"


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/lawyers")
def lawyers():
    return LAWYERS


@app.post("/ask")
def ask(req: AskRequest):
    hits = retrieve(req.question, req.lawyer)
    if not hits or hits[0]["score"] < REFUSAL_THRESHOLD:
        return {"answer": "I don't have a reliable source for this.", "citations": [], "refused": True}
    # TODO: Gemini generation grounded on hits, then verify citations against hits
    return {
        "answer": "(stub answer)",
        "citations": [h["chunk"]["citation"] for h in hits],
        "refused": False,
    }
