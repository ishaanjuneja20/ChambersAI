"""question -> retrieve -> refuse? -> Gemini -> verify citations. Used by the API and tools/try_ask.py."""
from __future__ import annotations
import os
import time
from concurrent.futures import ThreadPoolExecutor
from backend.rag import judgments as J
from backend.rag.generate import generate
from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve
from backend.rag.rewrite import rewrite_query
from backend.rag.verify import verify_citations

REFUSAL = {"en": "I don't have a reliable source for this.",
           "hi": "इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"}


def _judgments_on() -> bool:
    return os.environ.get("CHAMBERS_JUDGMENTS", "1") != "0" and J.judgments_available()


def _judgment_hits(question: str, domain: str, jr: str | None, k: int = 3) -> list[dict]:
    """Court-judgment paragraphs, only if the judgment index is installed and the question itself (not the
    Gemini rewrite, which makes off-topic questions look legal) clears JUDGMENT_REFUSAL_THRESHOLD."""
    if not _judgments_on():
        return []
    hits = J.retrieve_judgments(question, domain, k=k, rewritten=jr)
    return [h for h in hits if h["similarity_query"] >= J.JUDGMENT_REFUSAL_THRESHOLD]


def answer(question: str, lawyer: dict, lang: str | None = None) -> dict:
    lang = lang or detect_lang(question)
    refused = {"answer": REFUSAL.get(lang, REFUSAL["en"]), "citations": [], "refused": True}
    debug = os.environ.get("CHAMBERS_DEBUG") == "1"       # numbers and section names only, never the question text
    rewrite_on = os.environ.get("CHAMBERS_REWRITE", "1") != "0"
    t0 = time.time()
    rewritten = jr = None
    if rewrite_on:                                        # the two rewrites are independent: run them together
        with ThreadPoolExecutor(2) as ex:
            f1 = ex.submit(rewrite_query, question)
            f2 = ex.submit(rewrite_query, question, target="judgments") if _judgments_on() else None
            rewritten, jr = f1.result(), (f2.result() if f2 else None)
    t1 = time.time()
    hits = retrieve(question, lawyer["domain"], rewritten=rewritten)
    th = refusal_threshold(lang)
    hits = hits if hits and hits[0]["similarity"] >= th else []     # statutes only count when reliable
    jhits = _judgment_hits(question, lawyer["domain"], jr)
    if debug:
        refused["debug"] = {"lang": lang, "threshold": th, "rewrite": rewritten,
                            "top": [(h["chunk"]["citation"], round(h["similarity"], 3)) for h in hits[:3]],
                            "seconds": {"rewrite": round(t1 - t0, 1), "retrieve": round(time.time() - t1, 1)},
                            "judgments": [(h["chunk"]["citation"], round(h["similarity_query"], 3)) for h in jhits]}
    if not hits and not jhits:
        if debug:
            refused["debug"]["reason"] = "best similarity below threshold"
        return refused
    hits = hits + jhits
    t2 = time.time()
    raw = generate(question, hits, lang, lawyer)          # may raise GenerationError
    if debug:
        refused["debug"]["seconds"]["generate"] = round(time.time() - t2, 1)
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
