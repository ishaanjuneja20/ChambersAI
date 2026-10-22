import os

from backend.rag import pipeline as P
from backend.rag import rewrite as W

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
BROAD = ("false charge of an offence made with intent to injure a person\n"
         "SUB: false charge\nSUB: quashing of the case\nSUB: anticipatory bail")


def fake(text, sent=None):
    def post(url, key, body, timeout=60):
        if sent is not None:
            sent.append(body["contents"][0]["parts"][0]["text"])
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    return post


def rewrite(text, question="a fake case was filed on me", target="statutes", multi=True, sent=None):
    os.environ["GEMINI_API_KEYS"] = "k0"
    os.environ["GEMINI_MODELS"] = "m0"
    subs = [] if multi else None
    try:
        main = W.rewrite_query(question, post=fake(text, sent), target=target, subqueries=subs)
    finally:
        os.environ.pop("GEMINI_API_KEYS", None)
        os.environ.pop("GEMINI_MODELS", None)
    return main, subs


def test_broad_question_returns_the_main_query_and_up_to_three_sub_queries():
    main, subs = rewrite(BROAD)
    assert main == "false charge of an offence made with intent to injure a person"
    assert subs == ["false charge", "quashing of the case", "anticipatory bail"]
    _, subs = rewrite(BROAD + "\nSUB: a fourth one")
    assert len(subs) == 3                                              # capped


def test_sub_query_parsing_is_tolerant_and_strict_about_what_it_keeps():
    main, subs = rewrite('"theft query"\nsub: quashing of the case\n  SUB: "Quashing of the case"\nSUB: theft query\n'
                         'Some commentary\nSUB:\n- anticipatory bail')
    assert main == "theft query" and subs == ["quashing of the case"]  # repeats, the main query, commentary and empties dropped


def test_single_topic_question_gets_no_sub_queries_and_the_same_main_query():
    main, subs = rewrite("theft dishonestly takes movable property out of the possession of any person without consent",
                         "someone stole my phone")
    assert main.startswith("theft dishonestly") and subs == []


def test_without_the_list_the_prompt_and_the_result_are_exactly_as_before():
    sent = []
    main, subs = rewrite(BROAD, multi=False, sent=sent)
    assert subs is None and main == "false charge of an offence made with intent to injure a person"
    assert sent[0] == W.REWRITE_PROMPT + "a fake case was filed on me" and "SUB:" not in sent[0]


def test_multi_prompt_asks_for_statute_style_sub_queries_without_padding_or_acts():
    sent = []
    rewrite(BROAD, sent=sent)
    p = sent[0]
    assert p == W.REWRITE_MULTI_PROMPT + "a fake case was filed on me" and p.startswith(W.REWRITE_PROMPT[:-len("\n\nQuestion: ")])
    extra = W.MULTI_INSTRUCTION
    assert "up to 3 more lines" in extra and "'SUB:'" in extra and "statute-style" in extra
    assert "no padding words such as 'punishment' and no Act names" in extra
    assert "output ONLY the one query line and no SUB: lines" in extra


def test_judgment_rewrite_never_returns_sub_queries():
    sent = []
    main, subs = rewrite("employer wage reduction\nSUB: x", target="judgments", sent=sent)
    assert subs == [] and main == "employer wage reduction" and sent[0].startswith(W.JUDGMENT_REWRITE_PROMPT)


def test_a_failed_rewrite_falls_back_to_the_question_with_no_sub_queries():
    def boom(*a, **k):
        raise W.GenerationError("Gemini HTTP 403: bad key", 403)
    os.environ["GEMINI_API_KEYS"] = "k0"
    try:
        subs = []
        assert W.rewrite_query("q", post=boom, subqueries=subs) == "q" and subs == []
    finally:
        os.environ.pop("GEMINI_API_KEYS", None)


# ---------------------------------------------------------------- pipeline
def hit(cid, sim, boost=0.0):
    return {"chunk": {"id": cid, "kind": "act_section", "citation": cid, "text": "t"}, "score": sim + boost, "similarity": sim}


class Fakes:
    """Patch the rewrite and retrieval steps; `by_query` maps the `rewritten` text to the hits retrieve returns."""

    def __init__(self, main, subs, by_query):
        self.main, self.subs, self.by_query = main, subs, by_query
        self.retrieved, self.rewrite_kwargs = [], []

    def __enter__(self):
        self.saved = (P.rewrite_query, P.retrieve, P.J.judgments_available)
        P.J.judgments_available = lambda *a, **k: False

        def rewrite_query(q, **k):
            self.rewrite_kwargs.append(k)
            if k.get("subqueries") is not None:
                k["subqueries"].extend(self.subs)
            return self.main
        P.rewrite_query = rewrite_query

        def retrieve(q, domain, k=5, rewritten=None):
            self.retrieved.append(rewritten)
            return list(self.by_query.get(rewritten, []))
        P.retrieve = retrieve
        os.environ.pop("CHAMBERS_MULTIQUERY", None)
        return self

    def __exit__(self, *exc):
        P.rewrite_query, P.retrieve, P.J.judgments_available = self.saved
        os.environ.pop("CHAMBERS_MULTIQUERY", None)


def test_sub_query_results_are_merged_by_id_best_score_kept_and_cut_to_the_top_8():
    by_query = {
        "main": [hit("a", 0.80), hit("b", 0.70), hit("c", 0.66)],
        "s1": [hit("b", 0.75), hit("d", 0.74), hit("e", 0.73), hit("f", 0.72), hit("g", 0.71)],
        "s2": [hit("h", 0.69), hit("i", 0.68), hit("a", 0.60), hit("j", 0.67)],
    }
    with Fakes("main", ["s1", "s2"], by_query) as f:
        hits, info = P._prepare("a broad question", LAWYER, "en", True)
    assert f.retrieved == ["main", "s1", "s2"]
    ids = [h["chunk"]["id"] for h in hits]
    assert ids == ["a", "b", "d", "e", "f", "g", "h", "i"] and len(set(ids)) == 8     # best first, 8 kept, no duplicates
    assert next(h for h in hits if h["chunk"]["id"] == "b")["similarity"] == 0.75     # the better copy of b
    assert next(h for h in hits if h["chunk"]["id"] == "a")["similarity"] == 0.80
    assert info["subqueries"] == ["s1", "s2"]


def test_unrelated_question_still_refuses_with_sub_queries():
    weak = {"main": [hit("a", 0.40)], "s1": [hit("b", 0.45)], "s2": [hit("c", 0.50)]}
    with Fakes("main", ["s1", "s2"], weak):
        assert P._prepare("something unrelated", LAWYER, "en", False)[0] == []         # best 0.50 < 0.64
    close = {"main": [hit("a", 0.40)], "s1": [hit("b", 0.45)], "s2": [hit("c", 0.65)]}
    with Fakes("main", ["s1", "s2"], close):
        assert [h["chunk"]["id"] for h in P._prepare("q", LAWYER, "en", False)[0]][0] == "c"   # a sub-query can lift a real match


def test_single_topic_question_behaves_exactly_as_before():
    five = [hit(str(i), 0.9 - i * 0.01) for i in range(5)]
    with Fakes("main", [], {"main": five}) as f:
        hits, info = P._prepare("a single topic question", LAWYER, "en", True)
    assert hits == five and f.retrieved == ["main"] and info["subqueries"] == []


def test_switch_off_asks_for_no_sub_queries_and_retrieves_once():
    by_query = {"main": [hit("a", 0.80)], "s1": [hit("z", 0.99)]}
    with Fakes("main", ["s1"], by_query) as f:
        os.environ["CHAMBERS_MULTIQUERY"] = "0"
        hits, info = P._prepare("a broad question", LAWYER, "en", True)
    assert [h["chunk"]["id"] for h in hits] == ["a"] and f.retrieved == ["main"]
    assert all("subqueries" not in k for k in f.rewrite_kwargs) and info["subqueries"] == []


def test_judgment_rewrite_is_not_asked_for_sub_queries():
    saved = P.J.retrieve_judgments
    try:
        with Fakes("main", ["s1"], {"main": [hit("a", 0.8)], "s1": [hit("b", 0.7)]}) as f:
            P.J.judgments_available = lambda *a, **k: True
            P.J.retrieve_judgments = lambda *a, **k: []
            P._prepare("q", LAWYER, "en", False)
    finally:
        P.J.retrieve_judgments = saved
    statute = [k for k in f.rewrite_kwargs if k.get("target") != "judgments"]
    judgment = [k for k in f.rewrite_kwargs if k.get("target") == "judgments"]
    assert len(statute) == 1 and "subqueries" in statute[0]
    assert len(judgment) == 1 and "subqueries" not in judgment[0]
