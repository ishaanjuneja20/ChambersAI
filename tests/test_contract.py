"""The frozen output format of answer() / POST /ask (docs/CONTRACTS.md, "Frozen: answer()"). If one of these tests
has to change, the frontend and voice code must change with it: agree that with the team first."""
import os
import re

from backend.rag import pipeline as P

LAWYER = {"id": "criminal", "domain": "criminal", "name": "TBD", "personality": "TBD"}
HITS = [{"chunk": {"id": "a-1", "kind": "act_section", "citation": "BNS s.103 (formerly IPC s.302)", "text": "t"}, "similarity": 0.9},
        {"chunk": {"id": "sc-2#3", "kind": "judgment_para", "citation": "A v. B, [2001] 1 S.C.R. 9 (Supreme Court of India, 2001), from para 3", "text": "t"},
         "similarity": 0.9, "similarity_query": 0.9}]
KEYS = {"answer", "citations", "refused"}


def run(raw, hits=HITS, lang="en"):
    saved = (P._prepare, P.generate)
    os.environ.pop("CHAMBERS_DEBUG", None)
    P._prepare = lambda *a, **k: (hits, None)
    P.generate = lambda *a, **k: raw
    try:
        return P.answer("q", LAWYER, lang)
    finally:
        P._prepare, P.generate = saved


def test_answered_shape():
    out = run("Murder is punished [a-1]. The court held so [sc-2#3] and again [a-1] [x-9].")
    assert set(out) == KEYS and out["refused"] is False
    assert out["citations"] == ["BNS s.103 (formerly IPC s.302)", "A v. B, [2001] 1 S.C.R. 9 (Supreme Court of India, 2001), from para 3"]
    assert out["answer"].startswith("Murder is punished [1].") and "[2]" in out["answer"]
    assert "a-1" not in out["answer"] and "x-9" not in out["answer"]           # no internal ids ever reach the reader
    used = {int(n) for grp in re.findall(r"\[(\d+(?:,\s*\d+)*)\]", out["answer"]) for n in re.split(r",\s*", grp)}
    assert used == set(range(1, len(out["citations"]) + 1))                     # numbered from 1, no gaps, none missing


def test_refusal_shape_and_text():
    for raw, hits in (("NO_SOURCE", HITS), ("Murder is punished [zzz-1].", HITS), ("anything", [])):
        out = run(raw, hits)
        assert set(out) == KEYS and out["refused"] is True and out["citations"] == []
        assert out["answer"] == "I don't have a reliable source for this."
    assert run("NO_SOURCE", HITS, "hi")["answer"] == "इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"


def test_debug_key_only_when_enabled():
    saved = (P._prepare, P.generate)
    P._prepare = lambda *a, **k: (HITS, {"reason": None, "seconds": {}})
    P.generate = lambda *a, **k: "Yes [a-1]."
    os.environ["CHAMBERS_DEBUG"] = "1"
    try:
        assert set(P.answer("q", LAWYER, "en")) == KEYS | {"debug"}
    finally:
        os.environ.pop("CHAMBERS_DEBUG", None)
        P._prepare, P.generate = saved


def test_stream_event_types():
    saved = P._prepare
    P._prepare = lambda *a, **k: (HITS, None)
    try:
        evs = list(P.answer_stream("q", LAWYER, "en", stream=lambda *a, **k: iter(["The rule is X [a-1]. Done."])))
    finally:
        P._prepare = saved
    assert {e["type"] for e in evs} <= {"sentence", "done", "refused", "error"} and evs[-1]["type"] == "done"
    assert set(evs[0]) == {"type", "text", "speak", "new_citations"}
