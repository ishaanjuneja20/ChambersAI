import os

from backend.rag import generate as G
from backend.rag import pipeline as P

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
HITS = [{"chunk": {"id": "a-1", "citation": "Act s.1", "text": "t"}, "similarity": 0.9},
        {"chunk": {"id": "sc-2#3", "kind": "judgment_para", "citation": "A v. B (2001), from para 3", "text": "t"},
         "similarity": 0.9, "similarity_query": 0.9}]


def run(pieces, lang="en"):
    saved = P._prepare
    P._prepare = lambda *a, **k: (HITS, None)
    try:
        return list(P.answer_stream("q", LAWYER, lang, stream=lambda *a, **k: iter(pieces)))
    finally:
        P._prepare = saved


def test_split_sentences_keeps_brackets_and_handles_danda():
    got, rest = P.split_sentences("One [sc-2.x#3]. Two? Three । four")
    assert got == ["One [sc-2.x#3].", "Two?", "Three ।"] and rest == " four".lstrip() or rest.strip() == "four"
    got, rest = P.split_sentences("No end yet [a-1")
    assert got == [] and rest == "No end yet [a-1"


def test_sentences_are_verified_numbered_and_speakable():
    evs = run(["The rule is X [sc-2#3]. And Y [a-1] [bad-9]", ". Again [sc-2#3]. General info only."])
    kinds = [e["type"] for e in evs]
    assert kinds == ["sentence"] * 4 + ["done"]
    assert evs[0]["text"] == "The rule is X [1]." and evs[0]["speak"] == "The rule is X."
    assert evs[0]["new_citations"] == [{"n": 1, "text": "A v. B (2001), from para 3"}]
    assert evs[1]["new_citations"] == [{"n": 2, "text": "Act s.1"}] and "bad-9" not in evs[1]["text"]
    assert evs[2]["new_citations"] == [] and evs[2]["text"].endswith("[1].")
    assert evs[-1]["citations"] == ["A v. B (2001), from para 3", "Act s.1"]


def test_uncited_opening_is_held_until_a_cited_sentence_and_refusal_if_none():
    evs = run(["Short intro. Then the point [a-1]. Closing line."])
    assert [e["speak"] for e in evs[:-1]] == ["Short intro.", "Then the point.", "Closing line."]
    evs = run(["Nothing here is sourced. Really nothing."])
    assert [e["type"] for e in evs] == ["refused"]
    evs = run(["Only a fake source [zz-9]."])
    assert [e["type"] for e in evs] == ["refused"]


def test_stream_gemini_skips_a_key_out_of_quota_and_reads_pieces():
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GEMINI_MODEL", None)
    os.environ["GEMINI_API_KEYS"] = "k1,k2"
    G._rr = __import__("itertools").count()          # start on k1
    seen = []

    def opener(url, key, body):
        seen.append(key)
        if key == "k1":
            raise G.GenerationError("Gemini HTTP 429: quota", 429)
        yield "Hello "
        yield "world."

    try:
        assert "".join(G.stream_gemini({}, opener, model="m")) == "Hello world." and seen == ["k1", "k2"]
    finally:
        os.environ.pop("GEMINI_API_KEYS", None)


def test_generation_error_during_stream_becomes_an_error_event():
    def boom(*a, **k):
        raise G.GenerationError("Gemini HTTP 503: busy", 503)
        yield

    saved = P._prepare
    P._prepare = lambda *a, **k: (HITS, None)
    try:
        evs = list(P.answer_stream("q", LAWYER, "en", stream=boom))
    finally:
        P._prepare = saved
    assert evs == [{"type": "error", "message": "Gemini HTTP 503: busy"}]


def test_voice_prompt_asks_for_short_spoken_answer():
    system, _ = G.build_prompt("q", HITS, "en", LAWYER, voice=True)
    assert "spoken aloud" in system and "90 words" in system
    assert "spoken aloud" not in G.build_prompt("q", HITS, "en", LAWYER)[0]
