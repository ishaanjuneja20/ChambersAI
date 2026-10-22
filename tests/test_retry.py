import io
import contextlib
import os

from backend.rag import generate as G
from backend.rag import pipeline as P

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
STATUTE = {"chunk": {"id": "a-1", "kind": "act_section", "citation": "Act s.1", "text": "t"}, "similarity": 0.9}
SOFT_STATUTE = {"chunk": {"id": "a-2", "kind": "act_section", "citation": "Act s.2", "text": "t"}, "similarity": 0.62}   # under 0.64
JUDGMENT = {"chunk": {"id": "sc-2#3", "kind": "judgment_para", "citation": "A v. B (2001), from para 3", "text": "t"},
            "similarity": 0.9, "similarity_query": 0.9}
ANSWER = "The rule is X [a-1]."


class Setup:
    """Patch _prepare and generate; `outputs` are the model's successive replies."""

    def __init__(self, hits, outputs, debug=False, retry=None):
        self.hits, self.outputs, self.debug, self.retry = hits, list(outputs), debug, retry
        self.calls = 0

    def __enter__(self):
        self.saved = (P._prepare, P.generate, P.generate_stream)
        P._prepare = lambda *a, **k: (self.hits, {"seconds": {}} if self.debug else None)
        P.generate = self.generate
        os.environ.pop("CHAMBERS_RETRY", None)
        if self.retry is not None:
            os.environ["CHAMBERS_RETRY"] = self.retry
        if self.debug:
            os.environ["CHAMBERS_DEBUG"] = "1"
        return self

    def __exit__(self, *exc):
        P._prepare, P.generate, P.generate_stream = self.saved
        for k in ("CHAMBERS_RETRY", "CHAMBERS_DEBUG", "CHAMBERS_TRACE"):
            os.environ.pop(k, None)

    def generate(self, *a, **k):
        self.calls += 1
        return self.outputs[min(self.calls, len(self.outputs)) - 1]

    def stream(self, *a, **k):
        self.calls += 1
        yield self.outputs[min(self.calls, len(self.outputs)) - 1]


def test_no_source_then_an_answer_returns_the_answer():
    with Setup([STATUTE], [G.NO_SOURCE, ANSWER], debug=True) as s:
        out = P.answer("q", LAWYER, "en")
    assert not out["refused"] and out["citations"] == ["Act s.1"] and s.calls == 2
    assert out["debug"]["attempts"] == 2


def test_answer_can_arrive_on_the_third_attempt_and_no_more_than_three_are_made():
    with Setup([STATUTE], [G.NO_SOURCE, G.NO_SOURCE, ANSWER]) as s:
        assert not P.answer("q", LAWYER, "en")["refused"] and s.calls == 3
    with Setup([STATUTE], [G.NO_SOURCE] * 5, debug=True) as s:
        out = P.answer("q", LAWYER, "en")
    assert out["refused"] and s.calls == 3 and out["debug"]["attempts"] == 3
    assert out["debug"]["reason"] == "model found no answer in the sources"


def test_a_retry_that_answers_without_a_valid_citation_still_refuses():
    with Setup([STATUTE], [G.NO_SOURCE, "An answer citing [zz-9]."]) as s:
        assert P.answer("q", LAWYER, "en")["refused"] and s.calls == 2


def test_no_qualifying_statute_hit_means_no_retry():
    for hits in ([JUDGMENT], [SOFT_STATUTE, JUDGMENT], [SOFT_STATUTE], []):
        with Setup(hits, [G.NO_SOURCE, ANSWER]) as s:
            out = P.answer("q", LAWYER, "en")
        assert s.calls == (0 if not hits else 1) and out["refused"], hits
    with Setup([SOFT_STATUTE, STATUTE], [G.NO_SOURCE, ANSWER]) as s:       # one qualifying statute is enough
        assert not P.answer("q", LAWYER, "en")["refused"] and s.calls == 2


def test_hinglish_is_judged_against_the_english_threshold():
    hit = {"chunk": {"id": "a-1", "kind": "act_section", "citation": "Act s.1", "text": "t"}, "similarity": 0.62}
    with Setup([hit], [G.NO_SOURCE, ANSWER]) as s:                          # 0.62 clears the Hindi threshold (0.60) only
        assert P.answer("meri wife maang rahi hai", LAWYER, "hi")["refused"] and s.calls == 1
        s.calls = 0
        assert P.answer("तलाक के बाद गुजारा भत्ता", LAWYER, "hi")["refused"] is False and s.calls == 2


def test_retry_switch_and_generation_errors():
    with Setup([STATUTE], [G.NO_SOURCE, ANSWER], retry="0") as s:
        assert P.answer("q", LAWYER, "en")["refused"] and s.calls == 1
    with Setup([STATUTE], []) as s:
        def boom(*a, **k):
            s.calls += 1
            raise G.GenerationError("Gemini HTTP 503: busy", 503)
        P.generate = boom
        try:
            P.answer("q", LAWYER, "en")
            assert False
        except G.GenerationError:
            assert s.calls == 1                                              # an error is not retried


def test_stream_emits_nothing_before_a_successful_retry():
    events = []
    with Setup([STATUTE], [G.NO_SOURCE, ANSWER], debug=True) as s:
        def stream(*a, **k):
            if s.calls == 1:
                assert events == []                                          # the first attempt gave up silently
            yield from s.stream()
        for ev in P.answer_stream("q", LAWYER, "en", stream=stream):
            events.append(ev)
    assert [e["type"] for e in events] == ["sentence", "done"] and s.calls == 2
    assert events[0]["text"] == "The rule is X [1]." and events[-1]["debug"] == {"attempts": 2}


def test_stream_refuses_after_three_no_sources_and_never_retries_once_speech_started():
    with Setup([STATUTE], [G.NO_SOURCE]) as s:
        evs = list(P.answer_stream("q", LAWYER, "en", stream=s.stream))
    assert [e["type"] for e in evs] == ["refused"] and s.calls == 3
    with Setup([STATUTE], ["The rule is X [a-1]. NO_SOURCE"]) as s:         # already spoken: finish as before
        evs = list(P.answer_stream("q", LAWYER, "en", stream=s.stream))
    assert [e["type"] for e in evs] == ["sentence", "done"] and s.calls == 1
    with Setup([STATUTE], ["No citation anywhere."]) as s:                   # not NO_SOURCE: no retry
        assert [e["type"] for e in P.answer_stream("q", LAWYER, "en", stream=s.stream)] == ["refused"] and s.calls == 1


def test_stream_no_retry_without_a_statute_hit_or_when_switched_off_or_on_error():
    with Setup([JUDGMENT], [G.NO_SOURCE, ANSWER]) as s:
        assert [e["type"] for e in P.answer_stream("q", LAWYER, "en", stream=s.stream)] == ["refused"] and s.calls == 1
    with Setup([STATUTE], [G.NO_SOURCE, ANSWER], retry="0") as s:
        assert [e["type"] for e in P.answer_stream("q", LAWYER, "en", stream=s.stream)] == ["refused"] and s.calls == 1
    with Setup([STATUTE], []) as s:
        def boom(*a, **k):
            s.calls += 1
            raise G.GenerationError("Gemini HTTP 503: busy", 503)
            yield
        evs = list(P.answer_stream("q", LAWYER, "en", stream=boom))
        assert [e["type"] for e in evs] == ["error"] and s.calls == 1


def test_trace_lines_carry_the_attempt_count_and_no_content():
    err = io.StringIO()
    with Setup([STATUTE], [G.NO_SOURCE, ANSWER]):
        os.environ["CHAMBERS_TRACE"] = "1"
        with contextlib.redirect_stderr(err):
            P.answer("a private question", LAWYER, "en")
    assert err.getvalue().splitlines() == ["[pipeline] attempt 1 of 3: NO_SOURCE", "[pipeline] attempt 2 of 3: answered"]
