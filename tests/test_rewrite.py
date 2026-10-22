import os

from backend.rag import generate as G
from backend.rag import rewrite as W


def setup(keys="k0", models="m0,m1,m2"):
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GEMINI_MODEL", None)
    os.environ.pop("GEMINI_REWRITE_MODEL", None)
    os.environ["GEMINI_API_KEYS"] = keys
    os.environ["GEMINI_MODELS"] = models
    G._rr = __import__("itertools").count()
    G._dead_models.clear()
    G.WAITS = (0, 0, 0)


def teardown():
    os.environ.pop("GEMINI_API_KEYS", None)
    os.environ.pop("GEMINI_MODELS", None)
    G._dead_models.clear()


def fake(text, sent=None):
    def post(url, key, body, timeout=60):
        if sent is not None:
            sent.append(body["contents"][0]["parts"][0]["text"])
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    return post


def test_statute_prompt_asks_for_the_offence_name_and_operative_words():
    p = W.REWRITE_PROMPT
    assert "name of the offence or legal concept" in p and "operative words a statute would use" in p
    assert ("'someone stole my phone' -> 'theft dishonestly takes movable property out of the possession of any "
            "person without consent'") in p
    for word in ("'punishment'", "'imprisonment'", "'fine'"):
        assert word in p.split("Examples:")[0]                      # named in the "do not add" instruction
    assert "do NOT name an Act" in p


def test_punishment_hint_goes_last_and_only_once():
    p = W.REWRITE_PROMPT
    assert "end the query with the words 'what is the punishment' once" in p
    assert "never put it first and never repeat it" in p
    assert "Only if the user asks what the punishment is" in p      # not added to every query


def test_off_topic_safeguards_are_kept():
    p = W.REWRITE_PROMPT
    assert "NOT covered by the laws above" in p and "do NOT force it into them" in p
    assert "do NOT use statute-style words" in p and "real topic in plain words" in p
    assert "do NOT answer the question and do NOT name section numbers".lower() in p.lower()
    assert W.JUDGMENT_REWRITE_PROMPT.startswith("You help search a database of Supreme Court")   # untouched


def test_fake_rewrite_outputs_are_used_as_the_search_query():
    setup()
    try:
        sent = []
        theft = "theft dishonestly takes movable property out of the possession of any person without consent"
        assert W.rewrite_query("someone stole my phone", post=fake(f'"{theft}"\nextra line', sent)) == theft
        assert sent[0].endswith("Question: someone stole my phone")
        both = theft + " what is the punishment"
        assert W.rewrite_query("what is the punishment for stealing a phone", post=fake(both)) == both
        assert W.rewrite_query("home loan interest in my tax return",
                               post=fake("home loan interest income tax deduction")) == "home loan interest income tax deduction"
        assert W.rewrite_query("q", post=fake("   ")) == "q"                  # empty output: keep the question
        assert len(W.rewrite_query("q", post=fake("x" * 1000))) == 300
    finally:
        teardown()


def test_call_gemini_without_an_attempt_timeout_does_not_pass_one():
    setup()
    try:
        seen = []

        def post(url, key, body):                                       # no timeout parameter at all
            seen.append(1)
            return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

        assert G.call_gemini({}, post) == "ok" and seen == [1]
    finally:
        teardown()


# ---------------------------------------------------------------- the next (key, model) pair after a failure
def scripted(*results):
    """A fake post that plays `results` in order: an int raises GenerationError with that code, a str is the reply.
    Returns (post, calls) where calls lists the (model, key) used."""
    calls = []

    def post(url, key, body, timeout=60):
        calls.append((url.split("/models/")[1].split(":")[0], key))
        r = results[min(len(calls), len(results)) - 1]
        if isinstance(r, int):
            raise G.GenerationError(f"Gemini HTTP {r}: x", r)
        if r is None:
            return {"promptFeedback": {"blockReason": "SAFETY"}}      # blocked / empty: no candidates
        return {"candidates": [{"content": {"parts": [{"text": r}]}}]}
    return post, calls


def test_rewrite_temperature_is_zero_so_the_same_question_gives_the_same_search_text():
    setup()
    bodies = []

    def post(url, key, body, timeout=60):
        bodies.append(body)
        return {"candidates": [{"content": {"parts": [{"text": "theft dishonestly takes movable property"}]}}]}

    try:
        a = W.rewrite_query("someone stole my phone", post=post)
        b = W.rewrite_query("someone stole my phone", post=post)
        W.rewrite_query("someone stole my phone", post=post, target="judgments")
        W.translate_to_english("meri wife maang rahi hai", post=post)
    finally:
        teardown()
    assert a == b and len(bodies) == 3                                  # the repeated question is a cache hit
    assert all(body["generationConfig"]["temperature"] == 0 for body in bodies)


def test_a_failed_rewrite_call_moves_on_to_the_next_key_and_model_pair():
    setup(keys="k0,k1", models="m0,m1")
    try:
        post, calls = scripted(403, "theft dishonestly takes movable property")         # not a code call_gemini rotates on
        assert W.rewrite_query("someone stole my phone", post=post) == "theft dishonestly takes movable property"
        assert calls == [("m0", "k0"), ("m0", "k1")]                                    # the next pair in the rotation
    finally:
        teardown()


def test_an_empty_or_blocked_rewrite_reply_is_retried_too():
    setup(keys="k0,k1")
    try:
        post, calls = scripted(None, "retrenchment of worker notice")
        assert W.rewrite_query("fired without notice", post=post) == "retrenchment of worker notice" and len(calls) == 2
    finally:
        teardown()


def test_three_failed_calls_fall_back_to_the_question_and_there_is_no_fourth_try():
    setup(keys="k0,k1,k2")
    try:
        post, calls = scripted(403, 400, 503, "never reached")
        assert W.rewrite_query("someone stole my phone", post=post) == "someone stole my phone" and len(calls) == 3
        post, calls = scripted(None, None, None, "never reached")
        assert W.rewrite_query("q", post=post) == "q" and len(calls) == 3
    finally:
        teardown()


def test_a_successful_first_call_is_not_retried():
    setup()
    try:
        post, calls = scripted("theft query")
        assert W.rewrite_query("q", post=post) == "theft query" and len(calls) == 1
    finally:
        teardown()
