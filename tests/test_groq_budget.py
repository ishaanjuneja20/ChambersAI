"""The proactive Groq budget (backend/rag/groq_budget.py, generate.admit_steps): a new question waits for room instead of
hitting Groq's per-minute limit and falling back to a slow Gemini. Every model call is a fake, and time is a fake clock."""
import json
import threading
import types
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.rag import generate as G
from backend.rag import groq_budget as B
from backend.rag import pipeline as P
from tests.test_groq import BODY, HIT, LAWYER, Clock, FakeGemini, FakeGroq

BIG = "openai/gpt-oss-120b"


class UsageGroq(FakeGroq):
    """FakeGroq whose responses carry usage.total_tokens."""

    def __init__(self, clock, script, tokens=1000):
        super().__init__(clock, script)
        self.tokens = tokens

    def __call__(self, key, body, timeout=G.GROQ_TIMEOUT):
        data = super().__call__(key, body, timeout)
        data["usage"] = {"prompt_tokens": self.tokens - 50, "completion_tokens": 50, "total_tokens": self.tokens}
        return data


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    fake_time = types.SimpleNamespace(time=c.time, sleep=c.sleep)
    monkeypatch.setattr(G, "time", fake_time)
    monkeypatch.setattr(B, "time", fake_time)
    for name in ("GROQ_CHAT_MODELS", "CHAMBERS_TRACE", "CHAMBERS_GROQ_BUDGET", "GROQ_QUESTIONS_PER_MIN",
                 "GROQ_TOKENS_PER_MIN", "GROQ_MAX_WAIT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "groq,gemini")
    return c


def use(monkeypatch, clock, tokens=1000, **script):
    fake = UsageGroq(clock, {BIG: script.get("big", ["groq answer"]), "openai/gpt-oss-20b": script.get("small", ["small answer"])}, tokens)
    monkeypatch.setattr(G, "_groq_post", fake)
    return fake


def ask(gemini=None):
    """One whole user question that makes one model call."""
    gem = gemini or FakeGemini()
    with B.scope():
        return G.call_llm(BODY, gem), gem


def groq_calls(fake):
    return len(fake.calls)


# ---------------------------------------------------------------- waiting
def test_a_third_question_waits_for_room_then_uses_groq(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    gem = FakeGemini()
    assert ask(gem)[0] == "groq answer"                  # counted at 1000
    clock.now = 1040
    assert ask(gem)[0] == "groq answer"                  # counted at ~1040.4
    clock.now = 1050
    text, _ = ask(gem)                                   # budget full: the first leaves the window at 1060
    assert text == "groq answer" and gem.calls == 0 and groq_calls(fake) == 3
    assert 1060 <= clock.now < 1062                      # it waited about 10 s on the fake clock, not 0 and not 60


def test_a_wait_longer_than_the_cap_goes_straight_to_gemini(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    ask()
    ask()
    before = clock.now
    text, gem = ask()                                    # the first leaves the window in ~59 s: more than 15 s
    assert text == "from gemini" and gem.calls == 1 and groq_calls(fake) == 2
    assert clock.now == before                           # and it did not wait


def test_the_cap_and_the_limits_come_from_the_environment(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    monkeypatch.setenv("GROQ_QUESTIONS_PER_MIN", "1")
    monkeypatch.setenv("GROQ_MAX_WAIT", "70")
    ask()
    gem = FakeGemini()
    assert ask(gem)[0] == "groq answer" and gem.calls == 0          # one question per minute, but a 70 s wait is allowed
    assert groq_calls(fake) == 2 and clock.now >= 1060
    monkeypatch.setenv("GROQ_MAX_WAIT", "5")
    assert ask(gem)[0] == "from gemini"


def test_a_question_that_started_on_groq_keeps_using_it(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["a", "b", "c", "d"])
    gem = FakeGemini()
    assert ask(gem)[0] == "a"                            # another question took the first place
    clock.now = 1001
    with B.scope():                                      # this one takes the second: rewrite, answer, retry...
        assert G.call_llm(BODY, gem) == "b"
        before = clock.now
        for expected in ("c", "d", "d"):                 # the budget is full now, yet this question's calls still go to Groq
            assert G.call_llm(BODY, gem) == expected
        assert gem.calls == 0 and clock.now - before < 2          # no waiting: only the fake calls' own 0.4 s each
    assert groq_calls(fake) == 5
    assert len(B._questions[BIG]) == 2                   # five calls, two questions


def test_the_token_limit_trips_before_the_question_limit(clock, monkeypatch):
    fake = use(monkeypatch, clock, tokens=7200)          # one question used 7200 of the 7000 tokens, only 1 of 2 questions
    ask()
    clock.now = 1010
    text, gem = ask()
    assert text == "from gemini" and groq_calls(fake) == 1          # its tokens leave the window in 50 s: too long
    clock.now = 1050
    gem = FakeGemini()
    assert ask(gem)[0] == "groq answer" and gem.calls == 0          # 10 s to wait now
    assert 1060 <= clock.now < 1062


def test_tokens_under_the_limit_do_not_make_a_question_wait(clock, monkeypatch):
    use(monkeypatch, clock, tokens=3000)
    ask()
    clock.now = 1001
    ask()
    assert sum(n for _, n in B._tokens[BIG]) == 6000
    monkeypatch.setenv("GROQ_QUESTIONS_PER_MIN", "5")
    assert ask()[1].calls == 0                           # 6000 < 7000: no wait, no Gemini


def test_the_wait_ends_when_enough_of_the_oldest_tokens_have_left(clock, monkeypatch):
    fake = use(monkeypatch, clock, tokens=4000)
    monkeypatch.setenv("GROQ_QUESTIONS_PER_MIN", "10")
    ask()                                                # 4000 at 1000
    clock.now = 1020
    ask()                                                # 4000 at 1020: 8000 in the window
    clock.now = 1050
    gem = FakeGemini()
    ask(gem)                                             # dropping the first (-> 4000 < 7000) is enough: 1060, not 1080
    assert gem.calls == 0 and 1060 <= clock.now < 1062 and groq_calls(fake) == 3


def test_a_fully_expired_window_needs_no_wait(clock, monkeypatch):
    use(monkeypatch, clock, tokens=7500)
    ask()
    ask()
    clock.now += 61
    before = clock.now
    assert ask()[1].calls == 0 and clock.now - before < 1


# ---------------------------------------------------------------- keep-alives
def test_the_stream_sends_keepalive_comments_while_it_waits(clock, monkeypatch):
    use(monkeypatch, clock)
    ask()
    clock.now = 1040
    ask()
    clock.now = 1050                                     # a 10 s wait
    events = [{"type": "sentence", "text": "A [1].", "speak": "A.", "new_citations": [{"n": 1, "text": "Act s.1"}]},
              {"type": "done", "citations": ["Act s.1"]}]
    lines = list(P.sse_lines(lambda: iter(events)))
    keepalives = [l for l in lines if l == P.KEEPALIVE]
    assert P.KEEPALIVE == ": waiting\n\n" and 3 <= len(keepalives) <= 5     # at the start and about every 3 s
    assert lines[:len(keepalives)] == keepalives         # all before the first event
    data = [json.loads(l[len("data: "):]) for l in lines if l != P.KEEPALIVE]
    assert data == events and all(l.startswith("data: ") and l.endswith("\n\n") for l in lines if l != P.KEEPALIVE)
    assert {e["type"] for e in data} <= {"sentence", "done", "refused", "error"}      # no new event type
    assert clock.now >= 1060


def test_no_keepalive_when_there_is_room_or_the_wait_is_refused(clock, monkeypatch):
    use(monkeypatch, clock)
    events = [{"type": "refused", "answer": "x"}]
    assert list(P.sse_lines(lambda: iter(events))) == ['data: {"type": "refused", "answer": "x"}\n\n']
    ask()
    ask()                                                # full, and 59 s is too long: straight to Gemini, nothing extra sent
    assert list(P.sse_lines(lambda: iter(events))) == ['data: {"type": "refused", "answer": "x"}\n\n']


def test_the_question_admitted_by_the_stream_is_counted_once_not_again_by_its_calls(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["a", "b", "c"])
    gem = FakeGemini()

    def stream():
        for _ in range(3):                               # three model calls of one question
            yield {"type": "sentence", "text": G.call_llm(BODY, gem)}

    list(P.sse_lines(stream))
    assert groq_calls(fake) == 3 and len(B._questions[BIG]) == 1


def test_a_stream_for_a_skipped_question_uses_gemini_for_all_its_calls(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    ask()
    ask()
    gem = FakeGemini()
    list(P.sse_lines(lambda: iter([{"type": "sentence", "text": G.call_llm(BODY, gem)}, {"type": "sentence", "text": G.call_llm(BODY, gem)}])))
    assert gem.calls == 2 and groq_calls(fake) == 2


# ---------------------------------------------------------------- the switch and the 429 skip
def test_the_switch_turns_the_budget_off(clock, monkeypatch):
    fake = use(monkeypatch, clock, tokens=9000)
    monkeypatch.setenv("CHAMBERS_GROQ_BUDGET", "0")
    gem = FakeGemini()
    for _ in range(5):
        assert ask(gem)[0] == "groq answer"
    assert gem.calls == 0 and groq_calls(fake) == 5 and clock.now < 1003      # no waiting, no Gemini
    assert not B._questions and not B._tokens                                 # and nothing was counted
    assert list(P.sse_lines(lambda: iter([{"type": "done", "citations": []}]))) == ['data: {"type": "done", "citations": []}\n\n']


def test_gemini_only_order_never_waits(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "gemini")
    for _ in range(4):
        assert ask()[0] == "from gemini"
    assert groq_calls(fake) == 0 and clock.now == 1000


def test_a_real_429_still_skips_the_model_and_the_next_groq_model_answers(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=[("429", 30)], small=["small answer"])
    gem = FakeGemini()
    assert ask(gem)[0] == "small answer" and gem.calls == 0
    assert fake.models == [BIG, "openai/gpt-oss-20b"]
    assert ask(gem)[0] == "small answer" and fake.models[-1] == "openai/gpt-oss-20b" and BIG not in fake.models[2:]
    assert G._groq_skip_left(BIG) > 0


def test_a_failure_other_than_the_budget_still_falls_back_to_gemini(clock, monkeypatch):
    use(monkeypatch, clock, big=["timeout"], small=[500])
    text, gem = ask()
    assert text == "from gemini" and gem.calls == 1


def test_the_budget_follows_the_model_a_question_would_use(clock, monkeypatch):
    use(monkeypatch, clock)
    ask()
    ask()                                                # 120b is full
    G._groq_skip[BIG] = clock.now + 30                   # ...but skipped after a 429, so the question would use 20b, which has room
    gem = FakeGemini()
    with B.scope():
        assert G.call_llm(BODY, gem) == "small answer"
    assert gem.calls == 0 and len(B._questions["openai/gpt-oss-20b"]) == 1


# ---------------------------------------------------------------- concurrency
def test_concurrent_questions_take_only_the_places_there_are(clock, monkeypatch):
    results = []
    ticket_list = [B.Ticket() for _ in range(30)]
    gate = threading.Barrier(30)

    def go(t):
        gate.wait()
        results.append(B.reserve(BIG, t))

    threads = [threading.Thread(target=go, args=(t,)) for t in ticket_list]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(0.0) == 2 and len(B._questions[BIG]) == 2
    assert all(0 < r <= 60 for r in results if r)


def test_concurrent_whole_questions_send_the_rest_to_gemini(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    gem, outcomes = FakeGemini(), []
    gate = threading.Barrier(8)

    def go():
        gate.wait()
        outcomes.append(ask(gem)[0])

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count("groq answer") == 2 and outcomes.count("from gemini") == 6
    assert groq_calls(fake) == 2 and len(B._questions[BIG]) == 2


def test_two_parallel_calls_of_one_question_are_one_question(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    gem = FakeGemini()
    with B.scope():                                      # the two query rewrites run in parallel threads of one question
        with ThreadPoolExecutor(2) as ex:
            futures = [ex.submit(B.carry(G.call_llm), BODY, gem) for _ in range(2)]
            assert [f.result() for f in futures] == ["groq answer", "groq answer"]
    assert groq_calls(fake) == 2 and len(B._questions[BIG]) == 1 and gem.calls == 0


def test_a_stream_resumed_in_other_threads_is_still_one_question(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["NO_SOURCE", "NO_SOURCE", "Theft is wrong [a-1]. It is punished."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    gen = P.answer_stream("q", LAWYER, "en")
    evs = []
    with ThreadPoolExecutor(3) as ex:                    # like a server resuming the generator on whichever thread is free
        while True:
            try:
                evs.append(ex.submit(next, gen).result())
            except StopIteration:
                break
    assert [e["type"] for e in evs] == ["sentence", "sentence", "done"]
    assert groq_calls(fake) == 3 and len(B._questions[BIG]) == 1


def test_the_non_streaming_answer_counts_one_question_for_all_its_calls(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["NO_SOURCE", "NO_SOURCE", "Theft is wrong [a-1]."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    out = P.answer("q", LAWYER, "en")
    assert out["refused"] is False and groq_calls(fake) == 3 and len(B._questions[BIG]) == 1


# ---------------------------------------------------------------- trace
def test_trace_lines_for_a_wait_and_for_a_wait_that_is_too_long(clock, monkeypatch, capsys):
    monkeypatch.setenv("CHAMBERS_TRACE", "1")
    use(monkeypatch, clock)
    ask()
    clock.now = 1040
    ask()
    clock.now = 1050
    ask()                                                # waits
    capsys.readouterr()
    clock.now = 1051
    ask()                                                # the window holds the second and third: ~49 s
    err = capsys.readouterr().err
    assert "[llm] groq budget full, wait too long -> gemini" in err
    clock.now = 2000
    ask()
    ask()
    clock.now = 2045
    capsys.readouterr()
    ask()
    err = capsys.readouterr().err
    assert "[llm] groq budget full: waiting 15s" in err
    assert "gsk-test" not in err and "USER" not in err and "SYS" not in err


def test_environment_values_that_are_not_numbers_fall_back_to_the_defaults(monkeypatch):
    monkeypatch.setenv("GROQ_QUESTIONS_PER_MIN", "many")
    monkeypatch.setenv("GROQ_TOKENS_PER_MIN", "-5")
    monkeypatch.setenv("GROQ_MAX_WAIT", "")
    assert (B.max_questions(), B.max_tokens(), B.max_wait()) == (2, 7000, 15.0)


# ---------------------------------------------------------------- over HTTP
def test_ask_stream_over_http_sends_keepalives_then_the_unchanged_events(clock, monkeypatch):
    from fastapi.testclient import TestClient
    import backend.main as M

    use(monkeypatch, clock, big=["Theft is wrong [a-1]. It is punished."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    ask()
    clock.now = 1040
    ask()
    clock.now = 1050                                     # the third question waits ~10 s
    body = TestClient(M.app).post("/ask/stream", json={"lawyer": "criminal", "question": "q", "lang": "en"}).text
    blocks = [b for b in body.split("\n\n") if b]
    assert blocks.count(": waiting") >= 3
    events = [json.loads(b[len("data: "):]) for b in blocks if b != ": waiting"]
    assert [e["type"] for e in events] == ["sentence", "sentence", "done"] and events[-1]["citations"] == ["Act s.1"]
    assert blocks.index("data: " + json.dumps(events[0], ensure_ascii=False)) > blocks.index(": waiting")
