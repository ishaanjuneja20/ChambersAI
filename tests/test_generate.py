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
