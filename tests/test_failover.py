"""Per-attempt timeouts, failover over (key, model) pairs, the slow-model skip rule and the rewrite cache.
Every model call is a fake `post` that spends fake time, so nothing here really waits."""
import itertools
import types

import pytest

from backend.rag import generate as G
from backend.rag import rewrite as W

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
HIT = {"chunk": {"id": "a-1", "kind": "act_section", "citation": "Act s.1", "text": "t"}, "similarity": 0.9}
THEFT = "theft dishonestly takes movable property"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Fake:
    """A stand-in for generate._post. `seconds[model]` is how long that model takes (a number, or a list used one call at
    a time, the last entry repeating); `errors[model]` is an HTTP code it answers with after half a second. A model that
    takes longer than the timeout it was given fails after exactly that long, as the real _post does."""

    def __init__(self, clock, seconds=None, errors=None, text=THEFT):
        self.clock, self.seconds, self.errors, self.text = clock, seconds or {}, errors or {}, text
        self.calls = []                                       # (model, key, timeout)

    def __call__(self, url, key, body, timeout=45):
        model = url.split("/models/")[1].split(":")[0]
        self.calls.append((model, key, timeout))
        if model in self.errors:
            self.clock.now += 0.5
            raise G.GenerationError(f"Gemini HTTP {self.errors[model]}: x", self.errors[model])
        took = self.seconds.get(model, 1)
        if isinstance(took, list):
            took = took[min(sum(1 for c in self.calls if c[0] == model), len(took)) - 1]
        if took > timeout:
            self.clock.now += timeout
            raise G.GenerationTimeout("Gemini request failed (TimeoutError)")
        self.clock.now += took
        return {"candidates": [{"content": {"parts": [{"text": self.text}]}}]}

    @property
    def models(self):
        return [c[0] for c in self.calls]


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(G, "time", types.SimpleNamespace(time=c.time, sleep=c.sleep))
    for name in ("GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_REWRITE_MODEL", "CHAMBERS_TRACE", "GEMINI_THINKING_BUDGET"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GEMINI_API_KEYS", "k0")
    monkeypatch.setenv("GEMINI_MODELS", "m0,m1")
    monkeypatch.setattr(G, "_rr", itertools.count())
    monkeypatch.setattr(G, "_dead_models", set())
    return c


# ---------------------------------------------------------------- (1) a short timeout per attempt, then the next pair
def test_slow_rewrite_model_times_out_at_6_seconds_and_the_next_pair_answers(clock):
    post = Fake(clock, seconds={"m0": 18, "m1": 1})
    assert W.rewrite_query("someone stole my phone", post=post) == THEFT
    assert post.calls == [("m0", "k0", 6), ("m1", "k0", 6)]
    assert clock.now - 1000 == 7                              # 6 s lost on the slow model, 1 s on the fast one


def test_slow_answer_model_times_out_at_12_seconds_and_the_next_pair_answers(clock):
    post = Fake(clock, seconds={"m0": 20, "m1": 2}, text="The rule is X [a-1].")
    assert G.generate("q", [HIT], "en", LAWYER, post=post) == "The rule is X [a-1]."
    assert post.calls == [("m0", "k0", 12), ("m1", "k0", 12)]
    assert clock.now - 1000 == 14


def test_a_rewrite_that_fails_on_every_pair_falls_back_to_the_question_after_three_attempts(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEYS", "k0,k1")           # 2 keys x 3 models = 6 pairs, but only 3 may be tried
    monkeypatch.setenv("GEMINI_MODELS", "m0,m1,m2")
    post = Fake(clock, seconds={"m0": 18}, errors={"m1": 429, "m2": 503})
    assert W.rewrite_query("someone stole my phone", post=post) == "someone stole my phone"
    assert post.calls == [("m0", "k0", 6), ("m0", "k1", 6), ("m2", "k0", 6)]      # timeout, timeout (m0 is now skipped), 503
    assert clock.now - 1000 == 12.5                                               # and no waiting between attempts
    post = Fake(clock, errors={"m0": 503, "m1": 500, "m2": 429})                  # 5xx and 429 move on at once too
    assert W.rewrite_query("q", post=post) == "q" and len(post.calls) == 3


def test_an_answer_that_fails_on_every_pair_raises_after_three_attempts_without_waiting(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "m0,m1,m2,m3")
    post = Fake(clock, seconds={"m0": 30, "m1": 30}, errors={"m2": 503})
    with pytest.raises(G.GenerationError) as e:
        G.generate("q", [HIT], "en", LAWYER, post=post)
    assert e.value.code == 503 and post.models == ["m0", "m1", "m2"]
    assert clock.now - 1000 == 12 + 12 + 0.5


# ---------------------------------------------------------------- (2) the slow-model skip rule
def call(post):
    return G.call_gemini({}, post, attempt_timeout=G.ANSWER_TIMEOUT, max_pairs=G.MAX_PAIRS)


def test_two_slow_calls_in_a_row_skip_the_model_for_five_minutes(clock):
    post = Fake(clock, seconds={"m0": 11, "m1": 1})
    for _ in range(3):                                        # rotation: m0 (11 s), m1, m0 (11 s): m0's last two were slow
        call(post)
    assert post.models == ["m0", "m1", "m0"] and G._skip_left("m0") == 300
    post.calls.clear()
    for _ in range(4):
        call(post)
    assert post.models == ["m1"] * 4                          # m0 sits out
    clock.now += 301                                          # the five minutes are over
    post.calls.clear()
    for _ in range(2):
        call(post)
    assert "m0" in post.models
    assert G._skip_left("m0") > 0                             # one more slow call and it is out again (no second warm-up)


def test_the_skip_is_logged_under_chambers_trace(clock, monkeypatch, capsys):
    post = Fake(clock, seconds={"m0": 11})
    for _ in range(3):
        call(post)
    capsys.readouterr()
    monkeypatch.setenv("CHAMBERS_TRACE", "1")
    call(post)
    err = capsys.readouterr().err
    assert "[gemini] model=m0 skipped: last two calls took over 10s, 300s left" in err
    assert "model=m1 key=0 -> ok" in err and "secret" not in err
    monkeypatch.delenv("CHAMBERS_TRACE")
    call(post)
    assert capsys.readouterr().err == ""                      # silent without CHAMBERS_TRACE


def test_only_the_last_two_calls_count_and_exactly_10_seconds_is_not_slow(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    post = Fake(clock, seconds={"m0": [10, 10, 11, 1, 11, 11]})
    for took in (10, 10):
        call(post)
        assert G._skip_left("m0") == 0, took                  # 10 s is not longer than 10 s
    for _ in range(3):                                        # 11, 1, 11: a fast call in between breaks the run
        call(post)
        assert G._skip_left("m0") == 0
    call(post)                                                # 11 again: the last two (11, 11) were both slow
    assert G._skip_left("m0") == 300


def test_a_skipped_model_is_still_used_when_it_is_the_only_one(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    post = Fake(clock, seconds={"m0": 11})
    call(post)
    call(post)
    assert G._skip_left("m0") == 300
    assert call(post) == THEFT and post.models == ["m0"] * 3  # a slow answer beats none


def test_a_timed_out_attempt_counts_as_its_wait_plus_5_seconds(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    post = Fake(clock, seconds={"m0": [30, 1, 30, 30]})
    with pytest.raises(G.GenerationError):
        G.call_gemini({}, post, attempt_timeout=6, max_pairs=1)
    assert list(G._latency["m0"]) == [11] and G._skip_left("m0") == 0       # waited 6 s: recorded as 11 s, one is not enough
    G.call_gemini({}, post, attempt_timeout=6, max_pairs=1)                  # a fast call in between breaks the run
    with pytest.raises(G.GenerationError):
        G.call_gemini({}, post, attempt_timeout=6, max_pairs=1)
    assert G._skip_left("m0") == 0
    with pytest.raises(G.GenerationError):                                   # 11, 11: two timeouts in a row
        G.call_gemini({}, post, attempt_timeout=6, max_pairs=1)
    assert G._skip_left("m0") == 300


def test_two_rewrite_timeouts_in_a_row_skip_that_model_for_five_minutes(clock):
    post = Fake(clock, seconds={"m0": 18, "m1": 1})
    for q in ("someone stole my phone", "neighbour built a wall on my land", "landlord wants me out of the shop"):
        W.rewrite_query(q, post=post)       # rotation starts on m0, m1, m0: m0 times out at 6 s the first and third time
    assert post.models == ["m0", "m1", "m1", "m0", "m1"] and 290 < G._skip_left("m0") <= 300    # set at m0's timeout
    post.calls.clear()
    W.rewrite_query("employer cut my salary", post=post)
    assert post.models == ["m1"]                                             # no 6 s lost on m0 any more
    post.calls.clear()
    clock.now += 301
    W.rewrite_query("tenant not paying rent", post=post)
    assert post.models == ["m0", "m1"] and 290 < G._skip_left("m0") <= 300  # back after five minutes; one more timeout skips it again


def test_only_a_timeout_gets_the_penalty_not_a_fast_error(clock, monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    post = Fake(clock, errors={"m0": 429})
    for _ in range(3):
        with pytest.raises(G.GenerationError):
            G.call_gemini({}, post, attempt_timeout=6, max_pairs=1)
    assert list(G._latency["m0"]) == [0.5, 0.5] and G._skip_left("m0") == 0


def test_post_tells_a_timeout_from_other_network_failures(monkeypatch):
    import urllib.error
    import urllib.request

    def raising(exc):
        def urlopen(*a, **k):
            raise exc
        monkeypatch.setattr(urllib.request, "urlopen", urlopen)
        with pytest.raises(G.GenerationError) as e:
            G._post("http://x", "k", {}, timeout=1)
        return e.value

    assert isinstance(raising(TimeoutError()), G.GenerationTimeout)                       # read timeout
    assert isinstance(raising(urllib.error.URLError(TimeoutError())), G.GenerationTimeout)  # connect timeout
    err = raising(ConnectionResetError())
    assert not isinstance(err, G.GenerationTimeout) and err.code == 504                   # still retried, no penalty
    assert raising(TimeoutError()).code == 504


# ---------------------------------------------------------------- (3) the rewrite cache
def test_a_repeated_rewrite_comes_from_the_cache_without_a_model_call(clock):
    post = Fake(clock)
    first = W.rewrite_query("someone stole my phone", post=post, lang="en")
    again = W.rewrite_query("someone stole my phone", post=Fake(clock, text="never asked"), lang="en")
    assert first == again == THEFT and len(post.calls) == 1


def test_the_cache_is_per_question_lang_and_target(clock):
    post = Fake(clock)
    W.rewrite_query("someone stole my phone", post=post)
    W.rewrite_query("someone stole my phone", post=post, lang="hi")
    W.rewrite_query("someone stole my phone", post=post, target="judgments")
    W.rewrite_query("someone stole my wallet", post=post)
    assert len(post.calls) == 4
    W.rewrite_query("someone stole my phone", post=post)      # all four are now cached
    W.rewrite_query("someone stole my phone", post=post, lang="hi")
    W.rewrite_query("someone stole my phone", post=post, target="judgments")
    assert len(post.calls) == 4


def test_a_cached_rewrite_replays_its_sub_queries(clock):
    post = Fake(clock, text="false charge of an offence\nSUB: quashing of the case\nSUB: anticipatory bail")
    subs = []
    assert W.rewrite_query("a fake case was filed on me", post=post, subqueries=subs) == "false charge of an offence"
    again = []
    assert W.rewrite_query("a fake case was filed on me", post=Fake(clock, text="never asked"), subqueries=again) == \
        "false charge of an offence"
    assert again == subs == ["quashing of the case", "anticipatory bail"] and len(post.calls) == 1
    W.rewrite_query("a fake case was filed on me", post=post)  # asked without sub-queries: a different prompt, not a hit
    assert len(post.calls) == 2


def test_a_fallback_is_not_cached_and_the_cache_is_bounded(clock, monkeypatch):
    bad = Fake(clock, errors={"m0": 503, "m1": 503})
    assert W.rewrite_query("someone stole my phone", post=bad) == "someone stole my phone"
    good = Fake(clock)
    assert W.rewrite_query("someone stole my phone", post=good) == THEFT and len(good.calls) == 1   # tried again, not stuck
    assert W.rewrite_query("   ", post=Fake(clock, text="  ")) == "   "                             # an empty reply is no rewrite
    assert not any(k[0] == "   " for k in W._cache)
    monkeypatch.setattr(W, "CACHE_SIZE", 2)
    for q in ("one", "two", "three"):
        W.rewrite_query(q, post=good)
    assert len(W._cache) == 2 and ("one", "en", "statutes", False) not in W._cache      # the oldest went
