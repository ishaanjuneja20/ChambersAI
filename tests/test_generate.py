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
        raise G.GenerationError("Gemini HTTP 400: bad", 400)

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
        raise G.GenerationError("Gemini HTTP 400: bad", 400)

    assert W.rewrite_query("fired without notice", post=boom) == "fired without notice"
