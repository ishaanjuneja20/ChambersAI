import json
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve
from backend.rag.verify import verify_citations

app = FastAPI(title="ChambersAI")
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())


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


REFUSAL = "I don't have a reliable source for this."


def generate(question: str, hits: list[dict], lang: str) -> str:
    """TODO: Gemini answer grounded ONLY on `hits`, citing sources as [chunk-id], in the user's language."""
    return "(stub answer) " + " ".join(f"[{h['chunk']['id']}]" for h in hits[:3])


@app.post("/ask")
def ask(req: AskRequest):
    lang = req.lang or detect_lang(req.question)
    hits = retrieve(req.question, req.lawyer)
    if not hits or hits[0]["similarity"] < refusal_threshold(lang):
        return {"answer": REFUSAL, "citations": [], "refused": True}
    answer, citations, dropped = verify_citations(generate(req.question, hits, lang), hits)
    if not citations:                      # nothing verifiable to stand on: refuse rather than answer unsourced
        return {"answer": REFUSAL, "citations": [], "refused": True}
    return {"answer": answer, "citations": citations, "refused": False}
