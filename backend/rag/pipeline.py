"""question -> retrieve -> refuse? -> Gemini -> verify citations. Used by the API and tools/try_ask.py."""
from __future__ import annotations
import os
from backend.rag.generate import generate
from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve
from backend.rag.rewrite import rewrite_query
from backend.rag.verify import verify_citations

REFUSAL = {"en": "I don't have a reliable source for this.",
           "hi": "इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"}


def answer(question: str, lawyer: dict, lang: str | None = None) -> dict:
    lang = lang or detect_lang(question)
    refused = {"answer": REFUSAL.get(lang, REFUSAL["en"]), "citations": [], "refused": True}
    debug = os.environ.get("CHAMBERS_DEBUG") == "1"       # numbers and section names only, never the question text
    rewritten = rewrite_query(question) if os.environ.get("CHAMBERS_REWRITE", "1") != "0" else None
    hits = retrieve(question, lawyer["domain"], rewritten=rewritten)
    th = refusal_threshold(lang)
    if debug:
        refused["debug"] = {"lang": lang, "threshold": th, "rewrite": rewritten,
                            "top": [(h["chunk"]["citation"], round(h["similarity"], 3)) for h in hits[:3]]}
    if not hits or hits[0]["similarity"] < th:
        if debug:
            refused["debug"]["reason"] = "best similarity below threshold"
        return refused
    raw = generate(question, hits, lang, lawyer)          # may raise GenerationError
    text, citations, _dropped = verify_citations(raw, hits)
    if lang == "hi":                                     # Gemini sometimes ends sentences with the CJK full stop
        text = text.replace("\u3002", "\u0964")
    if not citations:                                     # nothing verifiable: refuse rather than answer unsourced
        if debug:
            refused["debug"]["reason"] = "model gave no valid citation"
        return refused
    out = {"answer": text, "citations": citations, "refused": False}
    if debug:
        out["debug"] = refused["debug"]
    return out
