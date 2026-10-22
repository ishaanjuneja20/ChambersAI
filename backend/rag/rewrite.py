"""Query rewriting: turn an everyday (English or Hindi) question into a short English legal search query.

Only the SEARCH uses the rewrite; the user's own question is still what Gemini answers. If anything goes wrong
the original question is used unchanged, so retrieval never depends on this step. The rewrite is never shown
as legal text and never contains citations (it is told not to name sections).
"""
from __future__ import annotations

import collections
import os
import re
import threading

from backend.rag.generate import MAX_PAIRS, GenerationError, _post, call_gemini, call_llm

REWRITE_MODEL = "gemini-flash-lite-latest"     # small and cheap: rewriting is a simple task
REWRITE_ATTEMPT_TIMEOUT = 6                    # seconds per attempt; a slow model fails over to the next pair (at most MAX_PAIRS)
REWRITE_TOKENS = 200                           # a query line and up to three short sub-queries; Groq adds reasoning headroom
CACHE_SIZE = 512                               # successful rewrites kept in memory (least recently used go first)

REWRITE_PROMPT = (
    "You help search a database of Indian statutes: BNS, BNSS, BSA, the Constitution, Hindu Marriage / Succession / "
    "Adoptions and Maintenance Acts, Special Marriage Act, Domestic Violence Act, Consumer Protection Act, Contract Act, "
    "Sale of Goods Act, Transfer of Property Act, Registration Act, Specific Relief Act, Limitation Act, RERA, "
    "Land Acquisition Act, RTI Act, POSH Act, and the labour codes (wages, industrial relations, social security, "
    "occupational safety).\n"
    "Rewrite the user's question as ONE short English search query (max 25 words): the name of the offence or legal "
    "concept involved, then the operative words a statute would use to define it. Do NOT add generic words such as "
    "'punishment', 'imprisonment', 'fine' or 'penalty', and do NOT name an Act. "
    "Examples: 'someone stole my phone' -> 'theft dishonestly takes movable property out of the possession of any "
    "person without consent'; 'fired without notice' -> 'retrenchment of worker notice compensation conditions "
    "precedent'; 'shop won't refund defective phone' -> 'consumer complaint defective goods refund replacement "
    "district commission'; 'police won't take my complaint' -> 'information in cognizable cases first information "
    "report refusal'. "
    "Only if the user asks what the punishment is, end the query with the words 'what is the punishment' once, to hint "
    "that the penalty clause is wanted; never put it first and never repeat it (for example 'what is the punishment "
    "for stealing a phone' -> 'theft dishonestly takes movable property out of the possession of any person without "
    "consent what is the punishment'). "
    "If the question is in Hindi, translate it. If the topic is NOT covered by the laws above (for example tax, cheques, "
    "company registration, patents), do NOT force it into them and do NOT use statute-style words for it: just state "
    "its real topic in plain words (for example 'home loan interest income tax deduction'). "
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


def _ask(body: dict, post) -> str:
    """The rewrite model call: each attempt gets REWRITE_ATTEMPT_TIMEOUT seconds, and a timeout, error, 429, 5xx or empty
    reply moves straight to the next (key, model) pair, MAX_PAIRS in all. Groq's models are tried first (generate.call_llm).
    Raises GenerationError if every attempt fails."""
    return call_llm(body, lambda: call_gemini(body, post, model=os.environ.get("GEMINI_REWRITE_MODEL") or None,    # None = the model chain
                                              attempt_timeout=REWRITE_ATTEMPT_TIMEOUT, max_pairs=MAX_PAIRS),
                    answer_tokens=REWRITE_TOKENS)


_cache: collections.OrderedDict = collections.OrderedDict()     # (question, lang, target, multi) -> (query, sub-queries)
_cache_lock = threading.Lock()


def _remember(key: tuple, main: str, subs: list[str]) -> None:
    with _cache_lock:
        _cache[key] = (main, tuple(subs))
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _recall(key: tuple):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def rewrite_query(question: str, post=_post, target: str = "statutes", subqueries: list | None = None,
                  lang: str = "en") -> str:
    """target: "statutes" (default) or "judgments" (words a Supreme Court judgment would use).
    subqueries (statutes only): pass a list to also get up to 3 short sub-queries appended to it when the question
    involves several legal steps or remedies; the return value is still the one main query.
    A rewrite the model produced is cached in memory per (question, lang, target) (and whether sub-queries were asked
    for); a fallback to the question is not."""
    prompt = JUDGMENT_REWRITE_PROMPT if target == "judgments" else REWRITE_PROMPT
    multi = subqueries is not None and target != "judgments"
    if multi:
        prompt = REWRITE_MULTI_PROMPT
    key = (question, lang, target, multi)
    hit = _recall(key)
    if hit:
        if multi:
            subqueries.extend(hit[1])
        return hit[0]
    body = {"contents": [{"role": "user", "parts": [{"text": prompt + question}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 400}}
    try:
        text = _ask(body, post)
    except GenerationError:
        if os.environ.get("CHAMBERS_TRACE"):
            import sys
            print("[gemini] rewrite failed, using the question as asked", file=sys.stderr, flush=True)
        return question
    line = text.strip().splitlines()[0].strip(" \"'`") if text.strip() else ""
    main = line[:300] or question
    subs = parse_subqueries(text, main) if multi else []
    if multi:
        subqueries.extend(subs)
    if line:
        _remember(key, main, subs)
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
        text = _ask(body, post)
    except GenerationError:
        return question
    line = text.strip().splitlines()[0].strip(" \"'`") if text.strip() else ""
    return line[:500] or question
