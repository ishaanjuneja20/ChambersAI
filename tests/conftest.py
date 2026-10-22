import pytest

from backend.rag import generate as G
from backend.rag import groq_budget as B
from backend.rag import rewrite as W


@pytest.fixture(autouse=True)
def fresh_model_state():
    """The rewrite cache and each model's recent latency live in memory for the whole process: start every test clean."""
    for state in (W._cache, G._latency, G._skip_until, G._groq_skip, G._groq_dead):
        state.clear()
    B.reset()                      # the Groq budget windows too (backend/rag/groq_budget.py)
    yield


@pytest.fixture(autouse=True)
def gemini_only(monkeypatch):
    """Groq is the first-choice provider by default, and a developer's backend/.env can hold a real GROQ_API_KEY: tests are
    Gemini-only unless they set CHAMBERS_LLM_ORDER themselves (tests/test_groq.py does, with a fake Groq)."""
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "gemini")


@pytest.fixture(autouse=True)
def general_tier_off(monkeypatch):
    """The general-guidance tier makes one more model call where the pipeline refuses: off by default in tests, so no test
    reaches Gemini by accident. tests/test_general.py turns it on with fake model replies."""
    monkeypatch.setenv("CHAMBERS_GENERAL", "0")
