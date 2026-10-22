"""Query rewriting: turn an everyday (English or Hindi) question into a short English legal search query.

Only the SEARCH uses the rewrite; the user's own question is still what Gemini answers. If anything goes wrong
the original question is used unchanged, so retrieval never depends on this step. The rewrite is never shown
as legal text and never contains citations (it is told not to name sections).
"""
from __future__ import annotations

import os
import re

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


MAX_SUBQUERIES = 3
_PROMPT_TAIL = "\n\nQuestion: "
MULTI_INSTRUCTION = (
    "\nIf the question involves several separate legal steps or remedies (for example a false case filed against the "
    "user: the false charge, getting the case quashed, bail in advance), add up to 3 more lines after the query, each "
    "starting with 'SUB:' and holding one short query (max 12 words) for one step or remedy, in the same statute-style "
    "operative words, with no padding words such as 'punishment' and no Act names. Example: 'false case filed on me' -> "
    "the query line 'false charge of an offence made with intent to injure a person', then 'SUB: false charge', "
    "'SUB: quashing of the case', 'SUB: anticipatory bail'. If the question is about a single topic, output ONLY the "
    "one query line and no SUB: lines.")
assert REWRITE_PROMPT.endswith(_PROMPT_TAIL)
REWRITE_MULTI_PROMPT = REWRITE_PROMPT[:-len(_PROMPT_TAIL)] + MULTI_INSTRUCTION + _PROMPT_TAIL


def parse_subqueries(text: str, main: str) -> list[str]:
    """The 'SUB: ...' lines after the query line: at most MAX_SUBQUERIES, no repeats, none equal to the main query."""
    subs: list[str] = []
    for line in text.strip().splitlines()[1:]:
        m = re.match(r"\s*SUB:\s*(.+)", line, re.I)
        q = m.group(1).strip(" \"'`")[:150] if m else ""
        if q and q.lower() != main.lower() and q.lower() not in (s.lower() for s in subs):
            subs.append(q)
    return subs[:MAX_SUBQUERIES]


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


def rewrite_query(question: str, post=_post, target: str = "statutes", subqueries: list | None = None) -> str:
    """target: "statutes" (default) or "judgments" (words a Supreme Court judgment would use).
    subqueries (statutes only): pass a list to also get up to 3 short sub-queries appended to it when the question
    involves several legal steps or remedies; the return value is still the one main query."""
    prompt = JUDGMENT_REWRITE_PROMPT if target == "judgments" else REWRITE_PROMPT
    multi = subqueries is not None and target != "judgments"
    if multi:
        prompt = REWRITE_MULTI_PROMPT
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
    main = line[:300] or question
    if multi:
        subqueries.extend(parse_subqueries(text, main))
    return main


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
