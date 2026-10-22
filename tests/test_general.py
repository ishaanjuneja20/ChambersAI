"""Tier 2, general guidance (backend/rag/general.py, wired in pipeline.py): fake model replies, no network."""
import pytest

from backend.rag import general as GN
from backend.rag import pipeline as P
from backend.rag.generate import ANSWER_TIMEOUT, MAX_PAIRS, GenerationError, NO_SOURCE

LAWYER = {"id": "labour", "domain": "labour", "name": "TBD", "personality": "TBD"}
STATUTE = {"chunk": {"id": "a-1", "kind": "act_section", "citation": "Act s.1", "text": "t"}, "similarity": 0.9}
GOOD = ("Your employer cannot simply stop your pay without a proper process. You can first write to them, and if that "
        "fails, approach the labour commissioner. It is wise to consult a lawyer about your specific case.")
REFUSAL = {"answer": "I don't have a reliable source for this.", "citations": [], "refused": True}


class Model:
    """Stands in for the Gemini call of the general tier; `replies` are its successive replies (an Exception is raised)."""

    def __init__(self, monkeypatch, replies):
        self.replies, self.calls = list(replies), []
        monkeypatch.setattr(GN, "call_gemini", self)

    def __call__(self, body, **kw):
        self.calls.append((body, kw))
        reply = self.replies[min(len(self.calls), len(self.replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("CHAMBERS_GENERAL", "1")
    monkeypatch.setenv("CHAMBERS_RETRY", "0")


def pipeline(monkeypatch, hits, generate_reply=NO_SOURCE):
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: (hits, {"seconds": {}} if P.os.environ.get("CHAMBERS_DEBUG") else None))
    monkeypatch.setattr(P, "generate", lambda *a, **k: generate_reply)
    return lambda *a, **k: iter([generate_reply])


def events(monkeypatch, hits, generate_reply=NO_SOURCE, lang="en"):
    stream = pipeline(monkeypatch, hits, generate_reply)
    return list(P.answer_stream("q", LAWYER, lang, stream=stream))


# ---------------------------------------------------------------- the check
def test_a_valid_reply_passes_the_check():
    assert GN.check_general(GOOD) is None


@pytest.mark.parametrize("reply, reason", [
    ("Approach the labour commissioner under section three of the law.", "section_or_article"),
    ("Article twenty-one protects your life.", "section_or_article"),
    ("File a complaint within 30 days.", "digit"),
    ("The Indian Contract Act 1872 applies.", "digit"),
    ("Section 420 applies.", "digit"),
    ("समय सीमा १५ दिन है।", "digit"),
    ("धारा के तहत शिकायत करें।", "section_or_article"),
    ("Ram v. Shyam decided this.", "case_name"),
    ("Ram vs. Shyam decided this.", "case_name"),
    ("Ram versus Shyam decided this.", "case_name"),
    ("The fee is Rs. fifty.", "amount"),
    ("The fee is ₹ fifty.", "amount"),
    ("You may get rupees as compensation.", "amount"),
    ("Most such cases succeed in a high percent.", "amount"),
    (GN.OUT_OF_SCOPE, "out_of_scope"),
    ("Out of scope.", "out_of_scope"),
    (NO_SOURCE, "no_source"),
    ("   ", "empty"),
])
def test_the_check_rejects(reply, reason):
    assert GN.check_general(reply) == reason


def test_the_call_uses_the_normal_rotation_limits_and_prompt(monkeypatch):
    model = Model(monkeypatch, [GOOD])
    assert GN.general_guidance("my boss has not paid me", "en") == (GOOD, "used")
    body, kw = model.calls[0]
    assert kw == {"attempt_timeout": ANSWER_TIMEOUT, "max_pairs": MAX_PAIRS}
    system = body["systemInstruction"]["parts"][0]["text"]
    assert "OUT_OF_SCOPE" in system and "80 words" in system and "English" in system and "consult a lawyer" in system
    assert body["contents"][0]["parts"][0]["text"] == "QUESTION\nmy boss has not paid me"
    Model(monkeypatch, [GOOD])
    assert "Hindi" in GN.build_prompt("q", "hi")[0]


def test_a_failed_model_call_is_an_outcome_not_an_error(monkeypatch):
    Model(monkeypatch, [GenerationError("Gemini HTTP 503: busy", 503)])
    assert GN.general_guidance("q", "en") == (None, "error")


# ---------------------------------------------------------------- /ask
def test_no_hits_gives_the_general_reply(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [])
    out = P.answer("my boss has not paid me", LAWYER, "en")
    assert out == {"answer": GOOD, "citations": [], "refused": False, "general": True}
    assert len(model.calls) == 1


def test_the_model_saying_no_source_gives_the_general_reply(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [STATUTE], NO_SOURCE)
    out = P.answer("q", LAWYER, "en")
    assert out["general"] is True and out["refused"] is False and out["citations"] == [] and len(model.calls) == 1


def test_a_reply_with_a_digit_is_refused(monkeypatch, on):
    Model(monkeypatch, ["File a complaint within 30 days. Please consult a lawyer."])
    pipeline(monkeypatch, [])
    assert P.answer("q", LAWYER, "en") == REFUSAL


def test_out_of_scope_is_refused_in_the_users_language(monkeypatch, on):
    Model(monkeypatch, [GN.OUT_OF_SCOPE])
    pipeline(monkeypatch, [])
    assert P.answer("how do I cook biryani", LAWYER, "en") == REFUSAL
    out = P.answer("बिरयानी कैसे बनाएं", LAWYER, "hi")
    assert out["refused"] is True and out["answer"] == P.REFUSAL["hi"] and "general" not in out


def test_a_failed_general_call_still_refuses_instead_of_raising(monkeypatch, on):
    Model(monkeypatch, [GenerationError("Gemini HTTP 503: busy", 503)])
    pipeline(monkeypatch, [])
    assert P.answer("q", LAWYER, "en") == REFUSAL


def test_a_cited_answer_is_unchanged_and_never_calls_tier_2(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [STATUTE], "The rule is X [a-1].")
    assert P.answer("q", LAWYER, "en") == {"answer": "The rule is X [1].", "citations": ["Act s.1"], "refused": False}
    assert model.calls == []


def test_an_answer_without_a_valid_citation_still_refuses_without_tier_2(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [STATUTE], "An answer citing [zz-9].")
    assert P.answer("q", LAWYER, "en") == REFUSAL and model.calls == []


def test_the_switch_turns_it_off(monkeypatch):
    for value in ("0", None):
        if value is None:
            monkeypatch.delenv("CHAMBERS_GENERAL")                         # unset means on
        else:
            monkeypatch.setenv("CHAMBERS_GENERAL", value)
        model = Model(monkeypatch, [GOOD])
        pipeline(monkeypatch, [])
        out = P.answer("q", LAWYER, "en")
        assert (out == REFUSAL and model.calls == []) if value == "0" else (out["general"] and len(model.calls) == 1)
    monkeypatch.setenv("CHAMBERS_GENERAL", "0")
    model = Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [STATUTE], NO_SOURCE)
    assert P.answer("q", LAWYER, "en") == REFUSAL and model.calls == []


def test_debug_shows_the_attempt_and_the_flag(monkeypatch, on):
    monkeypatch.setenv("CHAMBERS_DEBUG", "1")
    Model(monkeypatch, [GOOD, "Within 30 days."])
    pipeline(monkeypatch, [])
    dbg = P.answer("q", LAWYER, "en")["debug"]
    assert dbg["general_attempt"] is True and dbg["general"] is True and dbg["general_outcome"] == "used"
    assert dbg["reason"] == "best similarity below threshold"
    dbg = P.answer("q", LAWYER, "en")["debug"]                           # second reply has a digit
    assert dbg["general_attempt"] is True and dbg["general"] is False and dbg["general_outcome"] == "digit"
    monkeypatch.setenv("CHAMBERS_GENERAL", "0")
    dbg = P.answer("q", LAWYER, "en")["debug"]
    assert dbg["general_attempt"] is False and dbg["general"] is False


def test_debug_stays_out_of_cited_answers(monkeypatch, on):
    monkeypatch.setenv("CHAMBERS_DEBUG", "1")
    Model(monkeypatch, [GOOD])
    pipeline(monkeypatch, [STATUTE], "The rule is X [a-1].")
    assert not any(k.startswith("general") for k in P.answer("q", LAWYER, "en")["debug"])


# ---------------------------------------------------------------- /ask/stream
def test_stream_gives_general_sentences_and_a_general_done(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    evs = events(monkeypatch, [])
    assert [e["type"] for e in evs] == ["sentence"] * 3 + ["done"] and len(model.calls) == 1
    assert all(e["general"] is True and e["new_citations"] == [] and e["speak"] == e["text"] for e in evs[:-1])
    assert " ".join(e["text"] for e in evs[:-1]) == GOOD
    assert evs[-1] == {"type": "done", "citations": [], "general": True}


def test_stream_no_source_reaches_tier_2_after_the_retries(monkeypatch, on):
    monkeypatch.setenv("CHAMBERS_RETRY", "1")
    model = Model(monkeypatch, [GOOD])
    evs = events(monkeypatch, [STATUTE], NO_SOURCE)
    assert evs[-1]["type"] == "done" and evs[-1]["general"] is True and len(model.calls) == 1


@pytest.mark.parametrize("reply", ["File a complaint within 30 days. Please consult a lawyer.", GN.OUT_OF_SCOPE])
def test_stream_refuses_a_rejected_reply_before_anything_is_spoken(monkeypatch, on, reply):
    Model(monkeypatch, [reply])
    assert events(monkeypatch, []) == [{"type": "refused", "answer": P.REFUSAL["en"]}]
    assert events(monkeypatch, [STATUTE]) == [{"type": "refused", "answer": P.REFUSAL["en"]}]


def test_stream_cited_answers_are_unchanged(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    evs = events(monkeypatch, [STATUTE], "The rule is X [a-1].")
    assert [e["type"] for e in evs] == ["sentence", "done"] and model.calls == []
    assert set(evs[0]) == {"type", "text", "speak", "new_citations"} and evs[1] == {"type": "done", "citations": ["Act s.1"]}


def test_stream_uncited_answer_and_switch_off_do_not_call_tier_2(monkeypatch, on):
    model = Model(monkeypatch, [GOOD])
    assert [e["type"] for e in events(monkeypatch, [STATUTE], "No citation anywhere.")] == ["refused"]
    monkeypatch.setenv("CHAMBERS_GENERAL", "0")
    assert [e["type"] for e in events(monkeypatch, [])] == ["refused"]
    assert [e["type"] for e in events(monkeypatch, [STATUTE], NO_SOURCE)] == ["refused"]
    assert model.calls == []


def test_stream_debug_carries_the_attempt_and_the_flag(monkeypatch, on):
    monkeypatch.setenv("CHAMBERS_DEBUG", "1")
    Model(monkeypatch, [GOOD, GN.OUT_OF_SCOPE])
    done = events(monkeypatch, [])[-1]
    assert done["debug"] == {"general_attempt": True, "general": True, "general_outcome": "used"}
    refused = events(monkeypatch, [STATUTE], NO_SOURCE)[-1]
    assert refused["type"] == "refused" and refused["debug"]["attempts"] == 1
    assert refused["debug"]["general_attempt"] is True and refused["debug"]["general"] is False
