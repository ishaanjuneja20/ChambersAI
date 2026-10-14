"""question -> retrieve -> refuse? -> Gemini -> verify citations. Used by the API and tools/try_ask.py."""
from __future__ import annotations
from backend.rag.generate import generate
from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve
from backend.rag.verify import verify_citations

REFUSAL = {"en": "I don't have a reliable source for this.",
           "hi": "इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"}


def answer(question: str, lawyer: dict, lang: str | None = None) -> dict:
    lang = lang or detect_lang(question)
    refused = {"answer": REFUSAL.get(lang, REFUSAL["en"]), "citations": [], "refused": True}
    hits = retrieve(question, lawyer["domain"])
    if not hits or hits[0]["similarity"] < refusal_threshold(lang):
        return refused
    raw = generate(question, hits, lang, lawyer)          # may raise GenerationError
    text, citations, _dropped = verify_citations(raw, hits)
    if not citations:                                     # nothing verifiable: refuse rather than answer unsourced
        return refused
    return {"answer": text, "citations": citations, "refused": False}
