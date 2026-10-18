"""Query rewriting: turn an everyday (English or Hindi) question into a short English legal search query.

Only the SEARCH uses the rewrite; the user's own question is still what Gemini answers. If anything goes wrong
the original question is used unchanged, so retrieval never depends on this step. The rewrite is never shown
as legal text and never contains citations (it is told not to name sections).
"""
from __future__ import annotations

import os

from backend.rag.generate import GenerationError, _post, call_gemini

REWRITE_MODEL = "gemini-flash-lite-latest"     # small and cheap: rewriting is a simple task

REWRITE_PROMPT = (
    "You help search a database of Indian statutes: BNS, BNSS, BSA, the Constitution, Hindu Marriage / Succession / "
    "Adoptions and Maintenance Acts, Special Marriage Act, Domestic Violence Act, Consumer Protection Act, Contract Act, "
    "Sale of Goods Act, Transfer of Property Act, Registration Act, Specific Relief Act, Limitation Act, RERA, "
    "Land Acquisition Act, RTI Act, POSH Act, and the labour codes (wages, industrial relations, social security, "
    "occupational safety).\n"
    "Rewrite the user's question as ONE short English search query (max 25 words) using the words a statute would use. "
    "Examples: 'fired without notice' -> 'retrenchment of worker notice compensation conditions precedent'; "
    "'shop won't refund defective phone' -> 'consumer complaint defective goods refund replacement district commission'; "
    "'police won't take my complaint' -> 'information in cognizable cases first information report refusal'. "
    "If the question is in Hindi, translate it. If the topic is NOT covered by the laws above (for example tax, cheques, "
    "company registration, patents), do NOT force it into them: just state its real topic in plain words. "
    "Do NOT answer the question and do NOT name section numbers. Output only the query.\n\nQuestion: ")


JUDGMENT_REWRITE_PROMPT = (
    "You help search a database of Supreme Court of India judgments. "
    "Rewrite the user's question as ONE short English search query (max 25 words) using the legal terms, doctrines and "
    "issues a Supreme Court judgment or its headnote would use. "
    "Examples: 'employer cut my salary without telling me' -> 'unilateral reduction of wages workman employer "
    "industrial dispute'; 'neighbour built a wall on my land' -> 'encroachment boundary wall injunction "
    "title suit possession'; 'landlord wants me out of the shop' -> 'eviction tenant landlord bona fide "
    "requirement rent control'. "
    "If the question is in Hindi, translate it. Do NOT answer the question. Do NOT name any case, judge or section "
    "number. Output only the query.\n\nQuestion: ")


def rewrite_query(question: str, post=_post, target: str = "statutes") -> str:
    """target: "statutes" (default) or "judgments" (words a Supreme Court judgment would use)."""
    prompt = JUDGMENT_REWRITE_PROMPT if target == "judgments" else REWRITE_PROMPT
    body = {"contents": [{"role": "user", "parts": [{"text": prompt + question}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 400}}
    try:
        text = call_gemini(body, post, model=os.environ.get("GEMINI_REWRITE_MODEL") or None)   # None = the model chain
    except GenerationError:
        if os.environ.get("CHAMBERS_TRACE"):
            import sys
            print("[gemini] rewrite failed, using the question as asked", file=sys.stderr, flush=True)
        return question
    line = text.strip().splitlines()[0].strip(" \"'`") if text.strip() else ""
    return line[:300] or question


TRANSLATE_PROMPT = (
    "Translate this question, written in Hindi using English letters (Hinglish), into plain English. Keep every fact and "
    "number exactly as stated (for example '50L' becomes '50 lakh'). Do NOT answer it, add to it or explain it. "
    "Output only the translation.\n\nQuestion: ")


def translate_to_english(question: str, post=_post) -> str:
    """Faithful English translation of a Hinglish question, used only for retrieval (the answer is still written to the
    original question). Unlike rewrite_query it adds no legal words, so it cannot make an off-topic question look legal.
    On any failure the question is returned unchanged."""
    body = {"contents": [{"role": "user", "parts": [{"text": TRANSLATE_PROMPT + question}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 300}}
    try:
        text = call_gemini(body, post, model=os.environ.get("GEMINI_REWRITE_MODEL") or None)
    except GenerationError:
        return question
    line = text.strip().splitlines()[0].strip(" \"'`") if text.strip() else ""
    return line[:500] or question
