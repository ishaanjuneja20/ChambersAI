import os

from backend.rag import generate as G
from backend.rag.verify import verify_citations

HITS = [{"chunk": {"id": "bns_2023-103", "citation": "BNS s.103 (formerly IPC s.302)", "text": "Whoever commits murder..."},
         "score": 0.7, "similarity": 0.7}]
LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}


def fake_post(text):
    return lambda url, key, body, timeout=60: {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_prompt_has_sources_rules_and_language():
    system, user = G.build_prompt("punishment for murder?", HITS, "hi", LAWYER)
    assert "[bns_2023-103] BNS s.103" in user and "Whoever commits murder" in user
    assert "Hindi" in system and "ONLY the SOURCES" in system and "criminal" in system


def test_generate_then_verify_end_to_end():
    os.environ["GEMINI_API_KEY"] = "test"
    raw = G.generate("q", HITS, "en", LAWYER, post=fake_post("Murder is punished [bns_2023-103] and [bns_2023-999]."))
    clean, cits, dropped = verify_citations(raw, HITS)
    assert cits == ["BNS s.103 (formerly IPC s.302)"] and dropped == ["bns_2023-999"]


def test_missing_key_and_blocked_response_raise():
    os.environ.pop("GEMINI_API_KEY", None)
    try:
        G.generate("q", HITS, "en", LAWYER, post=fake_post("x"))
        assert False
    except G.GenerationError:
        pass
    os.environ["GEMINI_API_KEY"] = "test"
    try:
        G.generate("q", HITS, "en", LAWYER, post=lambda *a, **k: {"promptFeedback": {"blockReason": "SAFETY"}})
        assert False
    except G.GenerationError:
        pass


def test_retries_busy_model_then_succeeds(monkeypatch=None):
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    G.WAITS = (0, 0, 0)
    calls = []

    def flaky(url, key, body, timeout=60):
        calls.append(url)
        if len(calls) < 3:
            raise G.GenerationError("Gemini HTTP 503: busy", 503)
        return {"candidates": [{"content": {"parts": [{"text": "ok [bns_2023-103]"}]}}]}

    assert "ok" in G.generate("q", HITS, "en", LAWYER, post=flaky) and len(calls) == 3


def test_non_retryable_error_stops_immediately():
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    calls = []

    def bad(url, key, body, timeout=60):
        calls.append(1)
        raise G.GenerationError("Gemini HTTP 403: bad key", 403)

    try:
        G.generate("q", HITS, "en", LAWYER, post=bad)
        assert False
    except G.GenerationError:
        assert len(calls) == 1


def test_rewrite_returns_first_line_and_falls_back_on_error():
    from backend.rag import rewrite as W
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    assert W.rewrite_query("fired without notice", post=fake_post('"retrenchment notice compensation"\nextra')) == \
        "retrenchment notice compensation"

    def boom(*a, **k):
        raise G.GenerationError("Gemini HTTP 403: bad key", 403)

    assert W.rewrite_query("fired without notice", post=boom) == "fired without notice"


def test_pipeline_uses_judgments_and_filters_by_question_similarity():
    from backend.rag import pipeline as P
    jh = lambda sq: {"chunk": {"id": "sc-2001_1_1_9#12", "kind": "judgment_para", "citation": "A v. B, (2001) 1 SCR 9 (SC, 2001), from para 12", "text": "The Court held..."},
                     "score": 1.0, "similarity": 0.9, "similarity_query": sq, "card_similarity": 0.7}
    saved = (P.retrieve, P.rewrite_query, P.J.judgments_available, P.J.retrieve_judgments, P.generate)
    P.retrieve = lambda *a, **k: []
    P.rewrite_query = lambda q, **k: q
    P.J.judgments_available = lambda *a, **k: True
    P.generate = lambda q, hits, lang, lawyer: "The Court held this [sc-2001_1_1_9#12]."
    try:
        P.J.retrieve_judgments = lambda *a, **k: [jh(0.7)]
        out = P.answer("q", LAWYER, "en")
        assert not out["refused"] and out["citations"] == ["A v. B, (2001) 1 SCR 9 (SC, 2001), from para 12"]
        P.J.retrieve_judgments = lambda *a, **k: [jh(0.5)]          # rewrite may inflate; question alone is too weak
        assert P.answer("q", LAWYER, "en")["refused"]
    finally:
        P.retrieve, P.rewrite_query, P.J.judgments_available, P.J.retrieve_judgments, P.generate = saved


def test_network_timeout_is_retried():
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    G.WAITS = (0, 0, 0)
    calls = []

    def slow(url, key, body, timeout=60):
        calls.append(1)
        if len(calls) < 2:
            raise G.GenerationError("Gemini request failed (timeout)", 504)
        return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    assert G.generate("q", HITS, "en", LAWYER, post=slow) == "ok" and len(calls) == 2


def test_thinking_off_by_default_and_400_falls_back():
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    os.environ.pop("GEMINI_THINKING_BUDGET", None)
    bodies = []

    def picky(url, key, body, timeout=60):
        bodies.append("thinkingConfig" in body["generationConfig"])
        if bodies[-1]:
            raise G.GenerationError("Gemini HTTP 400: thinking not supported", 400)
        return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    assert G.generate("q", HITS, "en", LAWYER, post=picky) == "ok" and bodies == [True, False]
