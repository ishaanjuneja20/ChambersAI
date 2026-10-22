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


def test_any_error_on_an_answer_tries_up_to_three_pairs_then_raises():
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
        assert len(calls) == G.MAX_PAIRS == 3                       # 403 included: the next key or model may be fine


def test_rewrite_returns_first_line_and_falls_back_on_error():
    from backend.rag import rewrite as W
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    assert W.rewrite_query("fired without notice", post=fake_post('"retrenchment notice compensation"\nextra')) == \
        "retrenchment notice compensation"

    def boom(*a, **k):
        raise G.GenerationError("Gemini HTTP 403: bad key", 403)

    assert W.rewrite_query("my boss fired me without notice", post=boom) == "my boss fired me without notice"


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


def test_thinking_budget_zero_and_400_falls_back():
    os.environ["GEMINI_API_KEY"] = "test"
    os.environ.pop("GEMINI_MODEL", None)
    os.environ["GEMINI_THINKING_BUDGET"] = "0"
    bodies = []

    def picky(url, key, body, timeout=60):
        bodies.append("thinkingConfig" in body["generationConfig"])
        if bodies[-1]:
            raise G.GenerationError("Gemini HTTP 400: thinking not supported", 400)
        return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    assert G.generate("q", HITS, "en", LAWYER, post=picky) == "ok" and bodies == [True] * 3 + [False]   # 3 pairs, then without


def test_numbered_citations_share_numbers_and_follow_first_use():
    hits = [{"chunk": {"id": "a-1", "citation": "Act s.1"}}, {"chunk": {"id": "sc-2#3", "citation": "A v. B (2001), from para 3"}}]
    text, cits, dropped = verify_citations("X [sc-2#3]. Y [a-1]. Z [sc-2#3] [a-1] [zz-9].", hits, numbered=True)
    assert text.startswith("X [1]. Y [2]. Z [1] [2]"), text
    assert cits == ["A v. B (2001), from para 3", "Act s.1"] and dropped == ["zz-9"]


def test_key_pool_rotates_and_skips_a_key_that_is_out_of_quota():
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GEMINI_MODEL", None)
    os.environ["GEMINI_API_KEYS"] = "k1, k2 k3"
    G.WAITS = (0, 0, 0)
    assert G.api_keys() == ["k1", "k2", "k3"]
    seen = []

    def post(url, key, body, timeout=60):
        seen.append(key)
        if key == "k1":
            raise G.GenerationError("Gemini HTTP 429: quota", 429)
        return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    try:
        for _ in range(3):
            assert G.call_gemini({}, post, model="m") == "ok"
        # every call succeeded; a call that started on k1 moved straight on to k2 without waiting
        assert set(seen) == {"k1", "k2", "k3"} and seen.count("k1") == 1
        seen.clear()
        os.environ["GEMINI_API_KEYS"] = "k1"
        try:
            G.call_gemini({}, post, model="m")
            assert False
        except G.GenerationError as e:
            assert e.code == 429
    finally:
        os.environ.pop("GEMINI_API_KEYS", None)


def test_quota_on_first_model_moves_to_next_model_without_waiting():
    import time as _t
    os.environ.pop("GEMINI_MODEL", None)
    os.environ["GEMINI_MODELS"] = "m1,m2"
    os.environ["GEMINI_API_KEYS"] = "k1"
    G._rr = __import__("itertools").count()
    seen = []

    def post(url, key, body):
        seen.append(url.split("/models/")[1].split(":")[0])
        if seen[-1] == "m1":
            raise G.GenerationError("Gemini HTTP 429: quota", 429)
        return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    t0 = _t.time()
    try:
        assert G.call_gemini({}, post) == "ok"
    finally:
        os.environ.pop("GEMINI_MODELS", None)
        os.environ.pop("GEMINI_API_KEYS", None)
    assert seen == ["m1", "m2"] and _t.time() - t0 < 0.5
    os.environ["GEMINI_MODEL"] = "only"
    try:
        assert G.model_chain() == ["only"]
    finally:
        os.environ.pop("GEMINI_MODEL", None)
    assert G.model_chain() == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]


def test_soft_statutes_only_when_judgments_cleared_and_statute_just_under_threshold():
    from backend.rag import pipeline as P
    sh = lambda i, s: {"chunk": {"id": f"hma-{i}", "kind": "act_section", "citation": f"HMA s.{i}", "text": "x"}, "score": s, "similarity": s}
    jh = {"chunk": {"id": "sc-2001_1_1_9#12", "kind": "judgment_para", "citation": "A v. B", "text": "The Court held"},
          "score": 1.0, "similarity": 0.9, "similarity_query": 0.7, "card_similarity": 0.7}
    saved = (P.retrieve, P.rewrite_query, P.J.judgments_available, P.J.retrieve_judgments, P.STATUTE_MARGIN)
    P.rewrite_query = lambda q, **k: q
    P.J.judgments_available = lambda *a, **k: True
    try:
        P.J.retrieve_judgments = lambda *a, **k: [jh]
        P.retrieve = lambda *a, **k: [sh(1, 0.62), sh(2, 0.60), sh(3, 0.59), sh(4, 0.595), sh(5, 0.50)]
        hits, _ = P._prepare("q", LAWYER, "en", False)
        assert [h["chunk"]["citation"] for h in hits] == ["HMA s.1", "HMA s.2", "HMA s.3", "A v. B"]   # 3 closest within 0.05 of 0.64
        P.retrieve = lambda *a, **k: [sh(1, 0.55)]                                                 # too far under
        assert [h["chunk"]["id"] for h in P._prepare("q", LAWYER, "en", False)[0]] == ["sc-2001_1_1_9#12"]
        P.retrieve = lambda *a, **k: [sh(1, 0.62)]
        P.STATUTE_MARGIN = 0.0                                                                      # switched off
        assert [h["chunk"]["id"] for h in P._prepare("q", LAWYER, "en", False)[0]] == ["sc-2001_1_1_9#12"]
        P.STATUTE_MARGIN = 0.05
        P.J.retrieve_judgments = lambda *a, **k: []                                                 # no judgment cleared: refuse
        assert P._prepare("q", LAWYER, "en", False)[0] == []
    finally:
        P.retrieve, P.rewrite_query, P.J.judgments_available, P.J.retrieve_judgments, P.STATUTE_MARGIN = saved


def test_hinglish_is_translated_for_search_and_uses_english_thresholds():
    from backend.rag import pipeline as P
    seen = {}
    jh = {"chunk": {"id": "sc-1#1", "kind": "judgment_para", "citation": "A v. B", "text": "t"}, "score": 1.0,
          "similarity": 0.9, "similarity_query": 0.7, "card_similarity": 0.7}
    sh = {"chunk": {"id": "hma-25", "kind": "act_section", "citation": "HMA s.25", "text": "x"}, "score": 0.62, "similarity": 0.62}
    saved = (P.retrieve, P.rewrite_query, P.translate_to_english, P.J.judgments_available, P.J.retrieve_judgments)
    P.translate_to_english = lambda q, **k: "my wife wants 50 lakh alimony"
    P.rewrite_query = lambda q, **k: q
    P.J.judgments_available = lambda *a, **k: True
    P.J.retrieve_judgments = lambda q, *a, **k: seen.setdefault("j", q) and [jh]
    P.retrieve = lambda q, *a, **k: seen.setdefault("s", q) and [sh]
    try:
        hits, info = P._prepare("meri wife 50L alimony maang rahi hai", LAWYER, "hi", True)
        assert seen == {"j": "my wife wants 50 lakh alimony", "s": "my wife wants 50 lakh alimony"}
        assert info["lang"] == "hi" and info["search_lang"] == "en" and info["threshold"] == 0.64
        seen.clear()                                                   # Devanagari is not translated
        P.translate_to_english = lambda q, **k: 1 / 0
        info = P._prepare("तलाक के बाद गुजारा भत्ता", LAWYER, "hi", True)[1]
        assert info["search_lang"] == "hi" and info["threshold"] == 0.60 and seen["s"].startswith("तलाक")
    finally:
        P.retrieve, P.rewrite_query, P.translate_to_english, P.J.judgments_available, P.J.retrieve_judgments = saved


def test_prompt_has_the_no_assumed_facts_rule():
    system, _ = G.build_prompt("q", HITS, "en", LAWYER)
    assert "Do not assume facts the user has not stated" in system and "NO_SOURCE" in system
    assert "mistaken assumption" not in system                      # tried and removed: see DECISIONS.md (false premises)
    os.environ["CHAMBERS_STRICT_RULES"] = "0"
    try:
        assert "Do not assume facts" not in G.build_prompt("q", HITS, "en", LAWYER)[0]
    finally:
        os.environ.pop("CHAMBERS_STRICT_RULES", None)


# ---------------------------------------------------------------- (key, model) rotation
OK = {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}


def rotation(keys, models):
    """Fresh counter and no dropped models; returns a function that restores the environment."""
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GEMINI_MODEL", None)
    os.environ["GEMINI_API_KEYS"] = keys
    os.environ["GEMINI_MODELS"] = models
    G._rr = __import__("itertools").count()
    G._dead_models.clear()
    G.WAITS = (0, 0, 0)

    def restore():
        for k in ("GEMINI_API_KEYS", "GEMINI_MODELS", "CHAMBERS_TRACE"):
            os.environ.pop(k, None)
        G._dead_models.clear()
    return restore


def recorder(fail=lambda key, model: None):
    seen = []

    def post(url, key, body, timeout=60):
        model = url.split("/models/")[1].split(":")[0]
        seen.append((key, model))
        code = fail(key, model)
        if code:
            raise G.GenerationError(f"Gemini HTTP {code}: x", code)
        return OK
    return seen, post


def test_calls_rotate_keys_first_then_models():
    restore = rotation("k0,k1", "m0,m1,m2")
    try:
        seen, post = recorder()
        for _ in range(7):
            G.call_gemini({}, post)
        # call n: key n % 2, model (n // 2) % 3
        assert seen == [("k0", "m0"), ("k1", "m0"), ("k0", "m1"), ("k1", "m1"), ("k0", "m2"), ("k1", "m2"), ("k0", "m0")]
    finally:
        restore()


def test_429_tries_the_next_pair_before_waiting():
    restore = rotation("k0,k1", "m0,m1")
    G.WAITS = (30, 30, 30)                       # a real wait would hang the test: the first pass must not need one
    try:
        seen, post = recorder(lambda key, model: 429 if (key, model) in (("k0", "m0"), ("k1", "m0")) else None)
        assert G.call_gemini({}, post) == "ok"
        assert seen == [("k0", "m0"), ("k1", "m0"), ("k0", "m1")]       # both keys on m0 over quota, then the next model
    finally:
        restore()


def test_5xx_also_moves_on_and_a_whole_failed_pass_waits_then_raises():
    restore = rotation("k0", "m0,m1")
    waits = []
    saved = G.time.sleep
    G.time.sleep = waits.append
    G.WAITS = (1, 3)
    try:
        seen, post = recorder(lambda key, model: 503)
        try:
            G.call_gemini({}, post)
            assert False
        except G.GenerationError as e:
            assert e.code == 503
        assert len(seen) == 6 and waits == [0, 1, 3]                    # 2 pairs x 3 passes, waiting only between passes
    finally:
        G.time.sleep = saved
        restore()


def test_404_drops_the_model_for_good_and_warns_once_without_a_key(caplog=None):
    import logging
    restore = rotation("secret-key-0,secret-key-1", "gone,m1")
    records = []
    handler = logging.Handler()
    handler.emit = records.append
    G.logger.addHandler(handler)
    try:
        seen, post = recorder(lambda key, model: 404 if model == "gone" else None)
        assert G.call_gemini({}, post) == "ok"
        assert seen == [("secret-key-0", "gone"), ("secret-key-1", "m1")]
        assert G._dead_models == {"gone"}
        seen.clear()
        for _ in range(4):
            G.call_gemini({}, post)
        assert {m for _, m in seen} == {"m1"}                           # never asked again
        warnings = [r for r in records if r.levelno == logging.WARNING]
        assert len(warnings) == 1 and "gone" in warnings[0].getMessage() and "secret-key" not in warnings[0].getMessage()
    finally:
        G.logger.removeHandler(handler)
        restore()


def test_404_on_every_model_raises_the_404():
    restore = rotation("k0", "a,b")
    try:
        seen, post = recorder(lambda key, model: 404)
        try:
            G.call_gemini({}, post)
            assert False
        except G.GenerationError as e:
            assert e.code == 404
        assert [m for _, m in seen] == ["a", "b"] and G._dead_models == {"a", "b"}
    finally:
        restore()


def test_stream_rotates_and_falls_over_on_429_and_404():
    restore = rotation("k0,k1", "gone,m1")
    seen = []

    def opener(url, key, body):
        model = url.split("/models/")[1].split(":")[0]
        seen.append((key, model))
        if model == "gone":
            raise G.GenerationError("Gemini HTTP 404: no", 404)
        if key == "k1":
            raise G.GenerationError("Gemini HTTP 429: quota", 429)
        yield "Hi"
        yield " there"

    try:
        assert "".join(G.stream_gemini({}, opener)) == "Hi there"
        assert seen == [("k0", "gone"), ("k1", "m1"), ("k0", "m1")] or seen[0] == ("k0", "gone")
        assert seen[-1] == ("k0", "m1") and G._dead_models == {"gone"}
    finally:
        restore()


def test_stream_attempt_timeout_is_15_seconds():
    import inspect
    assert G.STREAM_TIMEOUT == 15
    assert inspect.signature(G._open_stream).parameters["timeout"].default == 15


def test_trace_prints_model_and_key_index_only(capsys=None):
    import io
    import contextlib
    restore = rotation("secret-key-0,secret-key-1", "m0")
    os.environ["CHAMBERS_TRACE"] = "1"
    err = io.StringIO()
    try:
        seen, post = recorder()
        with contextlib.redirect_stderr(err):
            G.call_gemini({}, post)
            G.call_gemini({}, post)
        out = err.getvalue()
        assert "model=m0 key=0 -> ok" in out and "model=m0 key=1 -> ok" in out and "secret" not in out
    finally:
        restore()


def test_rule_1_answers_from_a_relevant_source_and_refuses_only_when_none_is_on_topic():
    system, _ = G.build_prompt("q", HITS, "en", LAWYER)
    rule1 = system.split("\n2. ")[0]
    assert "ONLY the SOURCES" in rule1 and "outside knowledge" in rule1 and "never invent an id" in rule1
    assert "bears on the user's situation, answer from it in plain words" in rule1
    assert "partly cover the question, answer the part they cover and say plainly what they do not cover" in rule1
    assert "only when no source is about the topic at all" in rule1
    assert "different kind of event" in rule1 and "NO_SOURCE" in rule1
    assert "does not directly answer" not in rule1 and "directly answer the question" not in rule1
