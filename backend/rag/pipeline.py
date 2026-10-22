"""question -> retrieve -> refuse? -> Gemini -> verify citations. Used by the API and tools/try_ask.py."""
from __future__ import annotations
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from backend.rag import judgments as J
from backend.rag.generate import GenerationError, NO_SOURCE, generate, generate_stream
from backend.rag.retrieve import _DEVANAGARI, detect_lang, refusal_threshold, retrieve
from backend.rag.rewrite import rewrite_query, translate_to_english
from backend.rag.verify import verify_citations

REFUSAL = {"en": "I don't have a reliable source for this.",
           "hi": "इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"}


STATUTE_MARGIN = float(os.environ.get("CHAMBERS_STATUTE_MARGIN", "0.05"))   # 0 turns the soft statute hits off
SOFT_STATUTES = 3
RETRY_EXTRA = 2                                                     # extra model calls after NO_SOURCE (CHAMBERS_RETRY=0 turns them off)


def _search_lang(question: str, lang: str) -> str:
    """The language the thresholds are judged in: Hinglish is translated for search, so it uses the English ones
    (the same rule as _prepare)."""
    if lang == "hi" and not _DEVANAGARI.search(question) and os.environ.get("CHAMBERS_TRANSLATE", "1") != "0":
        return "en"
    return lang


def _retry_budget(question: str, hits: list[dict], lang: str) -> int:
    """How many more times to ask the model after it says NO_SOURCE. The model is flaky: the same sources sometimes
    answer and sometimes do not. Only when a statute hit clears the full refusal threshold (not the soft-margin
    statutes, which sit just under it, and not judgments alone); otherwise the refusal stands without a retry."""
    if os.environ.get("CHAMBERS_RETRY", "1") == "0":
        return 0
    th = refusal_threshold(_search_lang(question, lang))
    reliable = any(h["chunk"].get("kind") != "judgment_para" and h["similarity"] >= th for h in hits)
    return RETRY_EXTRA if reliable else 0


def _trace_attempt(n: int, of: int, outcome: str) -> None:
    """CHAMBERS_TRACE=1: one line per model attempt on stderr (attempt count and outcome). No content."""
    if os.environ.get("CHAMBERS_TRACE"):
        import sys
        print(f"[pipeline] attempt {n} of {of}: {outcome}", file=sys.stderr, flush=True)


def warmup() -> None:
    """Load bge-m3 and both indexes now (server start) so the first question doesn't pay for it."""
    from backend.rag import retrieve as R
    R.get_embedder()
    retrieve("warm up", "criminal", k=1)
    if _judgments_on():
        J.retrieve_judgments("warm up", "criminal", k=1)


def _judgments_on() -> bool:
    return os.environ.get("CHAMBERS_JUDGMENTS", "1") != "0" and J.judgments_available()


def _judgment_hits(question: str, domain: str, jr: str | None, k: int = 3) -> list[dict]:
    """Court-judgment paragraphs, only if the judgment index is installed and the question itself (not the
    Gemini rewrite, which makes off-topic questions look legal) clears JUDGMENT_REFUSAL_THRESHOLD."""
    if not _judgments_on():
        return []
    hits = J.retrieve_judgments(question, domain, k=k, rewritten=jr)
    return [h for h in hits if h["similarity_query"] >= J.JUDGMENT_REFUSAL_THRESHOLD]


def _prepare(question: str, lawyer: dict, lang: str, debug: bool):
    """Rewrite + retrieve. Returns (hits, debug_info); hits is empty when nothing clears its threshold."""
    rewrite_on = os.environ.get("CHAMBERS_REWRITE", "1") != "0"
    t0 = time.time()
    answer_question = question
    if lang == "hi" and not _DEVANAGARI.search(question) and os.environ.get("CHAMBERS_TRANSLATE", "1") != "0":
        # Hindi typed in English letters embeds ~0.1 lower against the English statutes and judgments than the same
        # question in English. Search with a faithful English translation and the English thresholds; the answer is
        # still written to the original question, in Hindi.
        question, lang_search = translate_to_english(question), "en"
    else:
        lang_search = lang
    rewritten = jr = None
    if rewrite_on:                                        # the two rewrites are independent: run them together
        with ThreadPoolExecutor(2) as ex:
            f1 = ex.submit(rewrite_query, question)
            f2 = ex.submit(rewrite_query, question, target="judgments") if _judgments_on() else None
            rewritten, jr = f1.result(), (f2.result() if f2 else None)
    t1 = time.time()
    hits = retrieve(question, lawyer["domain"], rewritten=rewritten)
    th = refusal_threshold(lang_search)
    jhits = _judgment_hits(question, lawyer["domain"], jr)
    if hits and hits[0]["similarity"] >= th:
        pass                                                         # statutes are reliable
    elif jhits and hits and hits[0]["similarity"] >= th - STATUTE_MARGIN:
        # The judgments already cleared their own threshold (so rule 4 holds) and the best statute is only just
        # under its own: send the closest statutes as supporting sources; the model still answers NO_SOURCE
        # if they do not fit.
        hits = [h for h in hits if h["similarity"] >= th - STATUTE_MARGIN][:SOFT_STATUTES]
    else:
        hits = []                                                    # statutes only count when reliable
    info = None
    if debug:
        info = {"lang": lang, "search_lang": lang_search, "threshold": th, "rewrite": rewritten,
                "top": [(h["chunk"]["citation"], round(h["similarity"], 3)) for h in hits[:3]],
                "seconds": {"rewrite": round(t1 - t0, 1), "retrieve": round(time.time() - t1, 1)},
                "judgments": [(h["chunk"]["citation"], round(h["similarity_query"], 3)) for h in jhits]}
    return hits + jhits, info


def answer(question: str, lawyer: dict, lang: str | None = None) -> dict:
    lang = lang or detect_lang(question)
    refused = {"answer": REFUSAL.get(lang, REFUSAL["en"]), "citations": [], "refused": True}
    debug = os.environ.get("CHAMBERS_DEBUG") == "1"       # numbers and section names only, never the question text
    hits, info = _prepare(question, lawyer, lang, debug)
    if debug:
        refused["debug"] = info
    if not hits:
        if debug:
            refused["debug"]["reason"] = "best similarity below threshold"
        return refused
    t2 = time.time()
    retries = _retry_budget(question, hits, lang)
    attempts = 1
    raw = generate(question, hits, lang, lawyer)          # may raise GenerationError
    while NO_SOURCE in raw and attempts <= retries:       # same hits, same prompt: the answer can differ from call to call
        _trace_attempt(attempts, 1 + retries, "NO_SOURCE")
        attempts += 1
        raw = generate(question, hits, lang, lawyer)
    _trace_attempt(attempts, 1 + retries, "NO_SOURCE" if NO_SOURCE in raw else "answered")
    if debug:
        refused["debug"]["seconds"]["generate"] = round(time.time() - t2, 1)
        refused["debug"]["attempts"] = attempts
    if NO_SOURCE in raw:                                  # the model says the sources don't answer it: refuse, don't cite
        if debug:
            refused["debug"]["reason"] = "model found no answer in the sources"
        return refused
    text, citations, _dropped = verify_citations(raw, hits, numbered=True)
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


# ------------------------------------------------------------------ streaming (voice)
_MARKER = re.compile(r"\s*\[\d+(?:,\s*\d+)*\]")
_ENDERS = ".!?\u0964\u3002"


def split_sentences(buf: str):
    """(finished sentences, remainder). A sentence ends at . ! ? or the Hindi danda followed by white space or at
    a blank line; never inside [square brackets] (source ids, citation numbers)."""
    out, start, depth = [], 0, 0
    for i, ch in enumerate(buf):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        elif depth == 0 and (ch in _ENDERS or ch == "\n") and (ch == "\n" or i + 1 < len(buf) and buf[i + 1].isspace()):
            piece = buf[start:i + 1].strip()
            if piece:
                out.append(piece)
            start = i + 1
    return out, buf[start:]


def answer_stream(question: str, lawyer: dict, lang: str | None = None, voice: bool = True, stream=generate_stream):
    """Yields dict events: {"type": "sentence", "text", "speak", "new_citations": [{"n", "text"}]} for each verified
    sentence, then {"type": "done", "citations": [...]}; or {"type": "refused", "answer"}; or {"type": "error"}.
    `text` keeps the [n] markers for the screen; `speak` has them removed for text-to-speech. Nothing is yielded
    until a sentence with a valid citation has appeared, so a refusal can still be made cleanly before any speech."""
    lang = lang or detect_lang(question)
    refusal = {"type": "refused", "answer": REFUSAL.get(lang, REFUSAL["en"])}
    debug = os.environ.get("CHAMBERS_DEBUG") == "1"
    try:
        hits, info = _prepare(question, lawyer, lang, debug)
        if not hits:
            yield refusal
            return
        retries = _retry_budget(question, hits, lang)

        def one_attempt():
            """Stream one model answer. Returns (outcome, order): "ok", "no_source" (the model gave up, nothing was
            yielded) or "uncited" (no sentence had a valid citation)."""
            order: list = []
            pending: list = []                            # sentences before the first valid citation
            started, sent_n, buf = False, 0, ""
            stop: list = []                               # set when the model answers NO_SOURCE

            def check(sentence):
                if lang == "hi":
                    sentence = sentence.replace("\u3002", "\u0964")
                text, _c, _d = verify_citations(sentence, hits, numbered=True, order=order)
                speak = _MARKER.sub("", text).strip()
                return text, speak, bool(_MARKER.search(text))

            def emit(text, speak):
                nonlocal sent_n
                new = [{"n": n + 1, "text": order[n]} for n in range(sent_n, len(order))]
                sent_n = len(order)
                return {"type": "sentence", "text": text, "speak": speak, "new_citations": new}

            def handle(sentences):
                nonlocal started
                for sen in sentences:
                    if NO_SOURCE in sen:                  # model gave up: nothing may be spoken
                        pending.clear()
                        stop.append(True)
                        return
                    text, speak, cited = check(sen)
                    if not speak:
                        continue
                    if started:
                        yield emit(text, speak)
                    elif cited:
                        started = True
                        for t, sp in pending:
                            yield emit(t, sp)
                        pending.clear()
                        yield emit(text, speak)
                    else:
                        pending.append((text, speak))

            for piece in stream(question, hits, lang, lawyer, voice=voice):
                buf += piece
                done, buf = split_sentences(buf)
                yield from handle(done)
                if stop or (not started and NO_SOURCE in buf):
                    break
            if buf.strip() and not stop and NO_SOURCE not in buf:
                yield from handle([buf.strip()])
            if started:
                return "ok", order
            return ("no_source" if stop or NO_SOURCE in buf else "uncited"), order

        attempts = 0
        while True:
            attempts += 1
            outcome, order = yield from one_attempt()
            _trace_attempt(attempts, 1 + retries, "answered" if outcome == "ok" else outcome)
            if outcome == "no_source" and attempts <= retries:    # nothing has been emitted yet, so a retry is invisible
                continue
            break
        extra = {"debug": {"attempts": attempts}} if debug else {}
        if outcome != "ok":
            yield {**refusal, **extra}
            return
        yield {"type": "done", "citations": order, **extra}
    except GenerationError as e:
        yield {"type": "error", "message": str(e)}
