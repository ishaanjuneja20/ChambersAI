"""Groq as the first-choice provider with Gemini as the fallback (generate.call_llm / stream_llm).
Every model call is a fake: nothing here touches the network, and time is a fake clock."""
import json
import types

import httpx
import pytest

from backend.rag import generate as G
from backend.rag import general as GN
from backend.rag import pipeline as P
from backend.rag import rewrite as W

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
HIT = {"chunk": {"id": "a-1", "kind": "act_section", "citation": "Act s.1", "text": "Theft is taking property."},
       "similarity": 0.9}
BODY = {"systemInstruction": {"parts": [{"text": "SYS"}]},
        "contents": [{"role": "user", "parts": [{"text": "USER"}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096}}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeGroq:
    """Stand-in for generate._groq_post. `script[model]` is a list of outcomes used one call at a time (the last repeats):
    a string is the reply text, an int an HTTP status, ("429", seconds) a 429 with retry-after, "timeout", "network",
    "" an empty reply, ("cut", text) a reply cut off at the token limit."""

    def __init__(self, clock, script):
        self.clock, self.script, self.calls = clock, script, []

    def __call__(self, key, body, timeout=G.GROQ_TIMEOUT):
        model = body["model"]
        self.calls.append((model, key, timeout, body))
        outcomes = self.script[model]
        out = outcomes[min(sum(1 for c in self.calls if c[0] == model), len(outcomes)) - 1]
        if out == "timeout":
            self.clock.now += timeout
            raise G.GenerationTimeout("Groq request timed out")
        if out == "network":
            self.clock.now += 0.1
            raise G.GenerationError("Groq request failed (ConnectError)", 504)
        self.clock.now += 0.4
        if isinstance(out, int):
            raise G.GenerationError(f"Groq HTTP {out}", out)
        if isinstance(out, tuple) and out[0] == "429":
            raise G.GenerationError("Groq HTTP 429", 429, retry_after=out[1])
        if isinstance(out, tuple):
            return {"choices": [{"message": {"content": out[1]}, "finish_reason": "length"}]}
        return {"choices": [{"message": {"content": out}, "finish_reason": "stop"}]}

    @property
    def models(self):
        return [c[0] for c in self.calls]


class FakeGemini:
    def __init__(self, text="from gemini"):
        self.text, self.calls = text, 0

    def __call__(self):
        self.calls += 1
        if isinstance(self.text, Exception):
            raise self.text
        return self.text


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(G, "time", types.SimpleNamespace(time=c.time, sleep=c.sleep))
    for name in ("GROQ_CHAT_MODELS", "CHAMBERS_TRACE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "groq,gemini")
    return c


def use(monkeypatch, clock, **script):
    fake = FakeGroq(clock, {"openai/gpt-oss-120b": script.get("big", ["groq answer"]),
                            "openai/gpt-oss-20b": script.get("small", ["small answer"])})
    monkeypatch.setattr(G, "_groq_post", fake)
    return fake


# ---------------------------------------------------------------- Groq answers
def test_groq_success_returns_its_text_and_never_calls_gemini(clock, monkeypatch):
    fake, gem = use(monkeypatch, clock), FakeGemini()
    assert G.call_llm(BODY, gem) == "groq answer"
    assert fake.models == ["openai/gpt-oss-120b"] and gem.calls == 0


def test_the_request_is_an_openai_chat_with_low_reasoning_and_headroom(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    G.call_llm(BODY, FakeGemini(), answer_tokens=400)
    model, key, timeout, sent = fake.calls[0]
    assert key == "gsk-test" and timeout == 8
    assert sent == {"model": "openai/gpt-oss-120b",
                    "messages": [{"role": "system", "content": "SYS"}, {"role": "user", "content": "USER"}],
                    "reasoning_effort": "low", "max_completion_tokens": 400 + G.GROQ_REASONING_HEADROOM, "temperature": 0.2}
    assert sent["max_completion_tokens"] > 400


def test_the_real_post_uses_the_endpoint_the_bearer_key_and_the_retry_after_header(monkeypatch):
    seen = {}

    def reply(request):
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        return httpx.Response(429, headers={"retry-after": "12"}) if seen["body"]["model"] == "slow" else \
            httpx.Response(200, json={"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]})

    real = httpx.Client(transport=httpx.MockTransport(reply))
    monkeypatch.setattr(G.httpx, "post", lambda url, **kw: real.post(url, json=kw["json"], headers=kw["headers"]))
    assert G._groq_post("gsk-test", {"model": "m"}, 8)["choices"][0]["message"]["content"] == "hi"
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions" and seen["auth"] == "Bearer gsk-test"
    with pytest.raises(G.GenerationError) as e:
        G._groq_post("gsk-test", {"model": "slow"}, 8)
    assert e.value.code == 429 and e.value.retry_after == 12.0 and "gsk-test" not in str(e.value)


def test_the_real_post_turns_a_timeout_and_a_network_error_into_generation_errors(monkeypatch):
    def boom(exc):
        def post(*a, **k):
            raise exc
        return post
    monkeypatch.setattr(G.httpx, "post", boom(httpx.ReadTimeout("x")))
    with pytest.raises(G.GenerationTimeout):
        G._groq_post("k", {}, 8)
    monkeypatch.setattr(G.httpx, "post", boom(httpx.ConnectError("x")))
    with pytest.raises(G.GenerationError) as e:
        G._groq_post("k", {}, 8)
    assert e.value.code == 504 and not isinstance(e.value, G.GenerationTimeout)


# ---------------------------------------------------------------- falling back
def test_a_groq_timeout_falls_through_the_groq_models_to_gemini(clock, monkeypatch):
    fake, gem = use(monkeypatch, clock, big=["timeout"], small=["timeout"]), FakeGemini()
    assert G.call_llm(BODY, gem) == "from gemini"
    assert fake.models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] and {c[2] for c in fake.calls} == {8}
    assert clock.now - 1000 == 16                            # each attempt waited its own 8 seconds


def test_a_timeout_on_the_big_model_still_lets_the_small_one_answer(clock, monkeypatch):
    use(monkeypatch, clock, big=["timeout"], small=["small answer"])
    assert G.call_llm(BODY, FakeGemini()) == "small answer"


@pytest.mark.parametrize("failure", [500, 503, "network"])
def test_5xx_and_network_errors_fall_back_to_gemini(clock, monkeypatch, failure):
    use(monkeypatch, clock, big=[failure], small=[failure])
    assert G.call_llm(BODY, FakeGemini()) == "from gemini"


def test_a_429_falls_back_and_skips_that_model_for_the_retry_after_seconds(clock, monkeypatch):
    fake, gem = use(monkeypatch, clock, big=[("429", 20)], small=[("429", 7)]), FakeGemini()
    assert G.call_llm(BODY, gem) == "from gemini"
    assert fake.models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    for _ in range(3):                                       # inside the window Groq is not asked at all
        clock.now += 1
        assert G.call_llm(BODY, gem) == "from gemini"
    assert len(fake.calls) == 2
    clock.now += 4                                           # 7 s after the 20b 429: it is back; 120b still has ~13 s
    use(monkeypatch, clock, big=["groq answer"], small=["small answer"])
    assert G.call_llm(BODY, gem) == "small answer"
    clock.now += 14                                          # 20 s after the 120b 429: back too
    assert G.call_llm(BODY, gem) == "groq answer"


def test_a_429_without_retry_after_skips_for_30_seconds(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=[429], small=[429])
    G.call_llm(BODY, FakeGemini())
    clock.now += 29
    G.call_llm(BODY, FakeGemini())
    assert len(fake.calls) == 2
    clock.now += 2
    G.call_llm(BODY, FakeGemini())
    assert len(fake.calls) == 4


def test_a_429_on_the_big_model_uses_the_small_one_at_once(clock, monkeypatch):
    use(monkeypatch, clock, big=[("429", 30)], small=["small answer"])
    assert G.call_llm(BODY, FakeGemini()) == "small answer"


def test_an_empty_groq_reply_moves_to_the_next_model_and_is_not_skipped(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["", "back again"], small=["small answer"])
    assert G.call_llm(BODY, FakeGemini()) == "small answer"
    assert fake.models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    assert G.call_llm(BODY, FakeGemini()) == "back again"      # an empty reply is not a reason to avoid the model


def test_a_blank_or_cut_off_reply_is_a_failure_so_half_an_answer_is_never_shown(clock, monkeypatch):
    use(monkeypatch, clock, big=["  \n"], small=[("cut", "The law says that")])
    assert G.call_llm(BODY, FakeGemini()) == "from gemini"


def test_every_groq_failure_ends_at_gemini_and_its_error_still_surfaces(clock, monkeypatch):
    use(monkeypatch, clock, big=[500], small=[500])
    err = G.GenerationError("Gemini HTTP 429: quota", 429)
    with pytest.raises(G.GenerationError) as e:
        G.call_llm(BODY, FakeGemini(err))
    assert e.value is err


def test_a_404_drops_the_groq_model_and_a_bad_key_skips_it_for_five_minutes(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=[404], small=[401])
    G.call_llm(BODY, FakeGemini())
    assert "openai/gpt-oss-120b" in G._groq_dead
    clock.now += 299
    G.call_llm(BODY, FakeGemini())
    assert len(fake.calls) == 2
    clock.now += 2
    G.call_llm(BODY, FakeGemini())
    assert fake.models[-1] == "openai/gpt-oss-20b"


def test_without_a_groq_key_groq_is_left_out_without_a_call(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    monkeypatch.delenv("GROQ_API_KEY")
    assert G.call_llm(BODY, FakeGemini()) == "from gemini" and fake.calls == []


# ---------------------------------------------------------------- CHAMBERS_LLM_ORDER and GROQ_CHAT_MODELS
def test_order_defaults_to_groq_then_gemini(monkeypatch):
    monkeypatch.delenv("CHAMBERS_LLM_ORDER")
    assert G.llm_order() == ["groq", "gemini"]
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "")
    assert G.llm_order() == ["groq", "gemini"]


@pytest.mark.parametrize("raw,expected", [("groq,gemini", ["groq", "gemini"]), ("gemini,groq", ["gemini", "groq"]),
                                          ("gemini", ["gemini"]), (" Gemini , GROQ ", ["gemini", "groq"]),
                                          ("gemini,gemini,openai", ["gemini"]), ("nonsense", ["groq", "gemini"])])
def test_order_variants_parse(monkeypatch, raw, expected):
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", raw)
    assert G.llm_order() == expected


def test_gemini_first_asks_groq_only_when_gemini_fails(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "gemini,groq")
    gem = FakeGemini()
    assert G.call_llm(BODY, gem) == "from gemini" and fake.calls == []
    gem.text = G.GenerationError("Gemini HTTP 429: quota", 429)
    assert G.call_llm(BODY, gem) == "groq answer"


def test_gemini_only_never_touches_groq_even_with_a_key(clock, monkeypatch):
    fake = use(monkeypatch, clock)
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "gemini")
    assert G.call_llm(BODY, FakeGemini()) == "from gemini" and fake.calls == []
    with pytest.raises(G.GenerationError):
        G.call_llm(BODY, FakeGemini(G.GenerationError("down", 503)))
    assert fake.calls == []


def test_groq_only_raises_when_groq_fails_and_never_calls_gemini(clock, monkeypatch):
    use(monkeypatch, clock, big=[500], small=[500])
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "groq")
    gem = FakeGemini()
    with pytest.raises(G.GenerationError):
        G.call_llm(BODY, gem)
    assert gem.calls == 0


def test_groq_chat_models_sets_the_models_and_their_order(clock, monkeypatch):
    assert G.groq_models() == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    monkeypatch.setenv("GROQ_CHAT_MODELS", "m-small, m-big")
    fake = FakeGroq(clock, {"m-small": ["a"], "m-big": ["b"]})
    monkeypatch.setattr(G, "_groq_post", fake)
    assert G.call_llm(BODY, FakeGemini()) == "a" and fake.models == ["m-small"]


# ---------------------------------------------------------------- streaming
def test_stream_llm_yields_groqs_whole_reply_as_one_piece(clock, monkeypatch):
    use(monkeypatch, clock)
    gem = []
    assert list(G.stream_llm(BODY, lambda: gem.append(1) or iter(["x"]))) == ["groq answer"] and gem == []


def test_stream_llm_falls_back_to_gemini_before_anything_is_spoken(clock, monkeypatch):
    use(monkeypatch, clock, big=["timeout"], small=[""])
    assert list(G.stream_llm(BODY, lambda: iter(["from ", "gemini"]))) == ["from ", "gemini"]


def test_stream_llm_gemini_first_falls_back_to_groq_only_before_the_first_piece(clock, monkeypatch):
    use(monkeypatch, clock)
    monkeypatch.setenv("CHAMBERS_LLM_ORDER", "gemini,groq")

    def dead():
        raise G.GenerationError("Gemini HTTP 429: quota", 429)
        yield

    assert list(G.stream_llm(BODY, dead)) == ["groq answer"]

    def half():
        yield "start "
        raise G.GenerationError("Gemini request failed", 504)

    seen = []
    with pytest.raises(G.GenerationError):
        for piece in G.stream_llm(BODY, half):
            seen.append(piece)
    assert seen == ["start "]                                # text already flowing: no switch mid-answer


# ---------------------------------------------------------------- the callers
def test_generate_goes_to_groq_with_the_unchanged_prompt_and_gemini_post_is_unused(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["Theft is wrong [a-1]."])
    sys_prompt, user_prompt = G.build_prompt("q", [HIT], "en", LAWYER)
    assert G.generate("q", [HIT], "en", LAWYER, post=lambda *a, **k: pytest.fail("Gemini was called")) == "Theft is wrong [a-1]."
    msgs = fake.calls[0][3]["messages"]
    assert msgs == [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}]
    assert "NO_SOURCE" in sys_prompt and "[bns_2023-103]" in sys_prompt            # the grounding rules are in what Groq gets


def test_generate_falls_back_to_the_gemini_post_when_groq_fails(clock, monkeypatch):
    use(monkeypatch, clock, big=[500], small=[500])
    monkeypatch.setenv("GEMINI_API_KEYS", "k0")
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    seen = []

    def post(url, key, body, timeout=45):
        seen.append(url)
        return {"candidates": [{"content": {"parts": [{"text": "Gemini says [a-1]."}]}}]}

    assert G.generate("q", [HIT], "en", LAWYER, post=post) == "Gemini says [a-1]." and len(seen) == 1


def test_rewrite_uses_groq_first_and_keeps_its_cache(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["theft dishonestly takes movable property"])
    gem = lambda *a, **k: pytest.fail("Gemini was called")
    assert W.rewrite_query("someone stole my phone", post=gem) == "theft dishonestly takes movable property"
    assert W.rewrite_query("someone stole my phone", post=gem) == "theft dishonestly takes movable property"
    assert len(fake.calls) == 1
    assert fake.calls[0][3]["max_completion_tokens"] == W.REWRITE_TOKENS + G.GROQ_REASONING_HEADROOM
    assert fake.calls[0][3]["temperature"] == 0


def test_a_failed_groq_rewrite_still_reaches_gemini_and_then_the_question(clock, monkeypatch):
    use(monkeypatch, clock, big=[500], small=[500])
    monkeypatch.setenv("GEMINI_API_KEYS", "k0")
    monkeypatch.setenv("GEMINI_MODELS", "m0")

    def bad_gemini(url, key, body, timeout=45):
        raise G.GenerationError("Gemini HTTP 503: x", 503)

    assert W.rewrite_query("someone stole my phone", post=bad_gemini) == "someone stole my phone"


def test_general_guidance_goes_through_groq_and_still_runs_the_code_check(clock, monkeypatch):
    use(monkeypatch, clock, big=["You could go to the police, and a lawyer can help with your case."])
    text, outcome = GN.general_guidance("what can I do", "en")
    assert outcome == "used" and text.startswith("You could go")
    use(monkeypatch, clock, big=["Under Section 420 you can sue."])
    assert GN.general_guidance("what can I do", "en") == (None, "digit")           # the check is on the reply, whoever wrote it


def test_a_groq_no_source_reply_is_still_a_refusal_and_is_retried_like_before(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["NO_SOURCE", "NO_SOURCE", "NO_SOURCE"])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([{**HIT, "similarity": 0.99}], None))
    out = P.answer("q", LAWYER, "en")
    assert out["refused"] and len(fake.calls) == 1 + P.RETRY_EXTRA


def test_a_groq_answer_citing_an_unknown_source_is_dropped_by_the_same_verification(clock, monkeypatch):
    use(monkeypatch, clock, big=["Theft is wrong [a-1]. Also [made-up-9]."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    out = P.answer("q", LAWYER, "en")
    assert not out["refused"] and out["citations"] == ["Act s.1"] and "made-up" not in out["answer"]
    use(monkeypatch, clock, big=["Only an invented source [made-up-9]."])
    assert P.answer("q", LAWYER, "en")["refused"]


def test_the_voice_stream_over_groq_emits_the_same_events(clock, monkeypatch):
    use(monkeypatch, clock, big=["Theft is wrong [a-1]. It is punished."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    evs = list(P.answer_stream("q", LAWYER, "en"))
    assert [e["type"] for e in evs] == ["sentence", "sentence", "done"]
    assert evs[0]["text"] == "Theft is wrong [1]." and evs[-1]["citations"] == ["Act s.1"]
    use(monkeypatch, clock, big=["NO_SOURCE"])
    assert [e["type"] for e in P.answer_stream("q", LAWYER, "en")] == ["refused"]


# ---------------------------------------------------------------- trace and secrets
def test_trace_shows_provider_model_and_seconds_and_never_a_key_or_text(clock, monkeypatch, capsys):
    monkeypatch.setenv("CHAMBERS_TRACE", "1")
    use(monkeypatch, clock, big=[("429", 30)], small=["secret legal text"])
    G.call_llm(BODY, FakeGemini())
    use(monkeypatch, clock, big=["x"], small=["x"])
    G.call_llm(BODY, FakeGemini())                           # 120b is skipped (429), 20b answers
    err = capsys.readouterr().err
    assert "[llm] groq openai/gpt-oss-120b -> 429 in 0.4s, falling back" in err
    assert "[llm] groq openai/gpt-oss-20b -> ok in 0.4s" in err
    assert "[llm] groq openai/gpt-oss-120b -> skipped, 30s left" in err
    assert "gsk-test" not in err and "secret legal text" not in err and "USER" not in err


def test_trace_is_silent_without_chambers_trace(clock, monkeypatch, capsys):
    use(monkeypatch, clock)
    G.call_llm(BODY, FakeGemini())
    assert capsys.readouterr().err == ""


def test_errors_never_carry_the_key_or_the_request(clock, monkeypatch):
    use(monkeypatch, clock, big=[500], small=[401])
    with pytest.raises(G.GenerationError) as e:
        G.call_groq(BODY)
    assert "gsk-test" not in str(e.value) and "USER" not in str(e.value)


# ---------------------------------------------------------------- fewer tokens
def test_a_section_matched_twice_is_sent_once():
    whole = "Part one. " * 50 + "Part two."
    a = {"chunk": {"id": "x-5-p1", "citation": "Act s.5", "text": whole, "expanded": True}, "similarity": 0.9}
    b = {"chunk": {"id": "x-5-p2", "citation": "Act s.5", "text": whole, "expanded": True}, "similarity": 0.8}
    c = {"chunk": {"id": "y-6", "citation": "Act s.6", "text": "Other section."}, "similarity": 0.7}
    _, user = G.build_prompt("q", [a, b, c], "en", LAWYER)
    assert user.count("Part one.") == 50 and "[x-5-p1]" in user and "[x-5-p2]" not in user and "[y-6]" in user
    assert [h["chunk"]["id"] for h in G._distinct([a, b, c])] == ["x-5-p1", "y-6"]


def test_different_slices_of_one_section_are_both_sent():
    a = {"chunk": {"id": "x-5-p1", "citation": "Act s.5", "text": "start […] middle", "expanded": True}, "similarity": 0.9}
    b = {"chunk": {"id": "x-5-p3", "citation": "Act s.5", "text": "middle […] the penalty", "expanded": True}, "similarity": 0.8}
    assert len(G._distinct([a, b])) == 2


# ---------------------------------------------------------------- gpt-oss quirks
def test_groqs_lenticular_brackets_become_ordinary_ones_and_are_verified_as_before(clock, monkeypatch):
    use(monkeypatch, clock, big=["Theft is wrong\u3010a-1\u3011. Also\u3010made-up-9\u3011."])
    monkeypatch.setattr(P, "_prepare", lambda *a, **k: ([HIT], None))
    out = P.answer("q", LAWYER, "en")
    assert not out["refused"] and out["citations"] == ["Act s.1"] and "made-up" not in out["answer"]


def test_an_answer_with_no_source_id_is_passed_over_for_the_next_model_then_gemini(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["A plain answer with no citation."], small=["Cited [a-1]."])
    assert G.generate("q", [HIT], "en", LAWYER) == "Cited [a-1]."
    assert fake.models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    use(monkeypatch, clock, big=["No id."], small=["Still no id."])
    monkeypatch.setenv("GEMINI_API_KEYS", "k0")
    monkeypatch.setenv("GEMINI_MODELS", "m0")
    gpost = lambda url, key, body, timeout=45: {"candidates": [{"content": {"parts": [{"text": "Gemini [a-1]."}]}}]}
    assert G.generate("q", [HIT], "en", LAWYER, post=gpost) == "Gemini [a-1]."


def test_no_source_counts_as_a_usable_answer_and_an_uncited_rewrite_is_not_checked(clock, monkeypatch):
    fake = use(monkeypatch, clock, big=["NO_SOURCE"])
    assert G.generate("q", [HIT], "en", LAWYER) == "NO_SOURCE" and len(fake.calls) == 1
    use(monkeypatch, clock, big=["theft dishonestly takes movable property"])
    assert W.rewrite_query("stolen phone", post=None) == "theft dishonestly takes movable property"
