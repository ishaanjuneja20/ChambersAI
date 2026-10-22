import contextlib
import io
import os

import numpy as np

from backend.rag import generate as G
from backend.rag import retrieve as R


def part(i, n, size, sec="303"):
    """Part i (1-based) of a section: text is 'Pi' + filler so the parts are easy to tell apart and have a set length."""
    cid = f"bns_2023-{sec}" + ("" if i == 1 else f"-p{i}")
    return {"id": cid, "kind": "act_section", "text": (f"P{i} " + "x" * size)[:size], "lang": "en", "domains": ["criminal"],
            "citation": f"BNS s.{sec}", "meta": {"act": "BNS", "act_short": "BNS_2023", "section": sec}}


def index(chunks, best):
    """An index whose query vector is closest to chunk number `best` (1-based) of the first section."""
    vecs = np.array([[1.0, 0.0]] * len(chunks))
    vecs[best - 1] = [0.0, 1.0]
    return R.Index(chunks, vecs), (lambda t: np.array([[0.0, 1.0]] * len(t)))


def search(chunks, best, **kw):
    idx, emb = index(chunks, best)
    return R.search("q", "criminal", 5, idx, emb)[0]


def body(hit):
    """The merged text as a list of 'P<i>' labels and '[…]' gaps, in order."""
    return [("[…]" if p == "[…]" else p.split()[0]) for p in hit["chunk"]["text"].split("\n\n")]


def test_six_part_section_over_the_limit_keeps_match_neighbours_and_the_final_part():
    chunks = [part(i, 6, 2000) for i in range(1, 7)]                      # 12000 characters in all
    h = search(chunks, 3)
    assert body(h) == ["[…]", "P2", "P3", "P4", "[…]", "P6"]                # part 1 and part 5 left out, each marked
    assert h["chunk"]["parts"] == [2, 3, 4, 6] and h["chunk"]["expanded"] is True
    assert h["chunk"]["id"] == "bns_2023-303-p3" and h["chunk"]["citation"] == "BNS s.303"   # the matched part's identity
    assert h["similarity"] == 1.0
    assert chunks[2]["text"].startswith("P3") and "[…]" not in chunks[2]["text"]            # the index is not changed
    assert G.source_text(h["chunk"]) == h["chunk"]["text"]                                  # the prompt does not cut it


def test_match_at_either_end_of_a_long_section():
    chunks = [part(i, 6, 2000) for i in range(1, 7)]
    assert body(search(chunks, 1)) == ["P1", "P2", "[…]", "P6"]
    assert body(search(chunks, 6)) == ["[…]", "P5", "P6"]
    assert body(search(chunks, 5)) == ["[…]", "P4", "P5", "P6"]
    assert body(search(chunks, 2)) == ["P1", "P2", "P3", "[…]", "P6"]


def test_section_of_at_most_9000_characters_is_merged_whole_with_no_gap():
    chunks = [part(i, 6, 1500) for i in range(1, 7)]                      # exactly 9000
    h = search(chunks, 3)
    assert body(h) == ["P1", "P2", "P3", "P4", "P5", "P6"] and h["chunk"]["parts"] == [1, 2, 3, 4, 5, 6]
    assert "[…]" not in h["chunk"]["text"]
    chunks = [part(i, 6, 1500) for i in range(1, 7)]
    chunks[5]["text"] += "y"                                              # 9001: one over
    assert "[…]" in search(chunks, 3)["chunk"]["text"]


def test_parts_are_put_in_part_order_even_if_the_index_holds_them_out_of_order():
    chunks = [part(i, 3, 100) for i in (3, 1, 2)]
    assert body(search(chunks, 1)) == ["P1", "P2", "P3"]


def test_a_section_in_one_piece_is_returned_untouched_and_other_sections_are_not_mixed_in():
    one, other = part(1, 1, 300), part(1, 1, 300, sec="304")
    h = search([one, other], 1)
    assert h["chunk"] is one and "expanded" not in h["chunk"] and G.source_text(h["chunk"]) == one["text"]
    both = [part(i, 2, 100) for i in (1, 2)] + [part(1, 1, 100, sec="304")]
    assert body(search(both, 1)) == ["P1", "P2"]


def test_unexpanded_text_is_still_cut_for_the_prompt():
    assert len(G.source_text({"text": "x" * 6000})) == G.MAX_SOURCE_CHARS


def test_trace_logs_section_id_parts_included_and_total_length():
    chunks = [part(i, 6, 2000) for i in range(1, 7)] + [part(1, 1, 50, sec="304")]
    idx, emb = index(chunks, 3)
    os.environ["CHAMBERS_TRACE"] = "1"
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            h = R.search("q", "criminal", 5, idx, emb)[0]
    finally:
        os.environ.pop("CHAMBERS_TRACE", None)
    assert err.getvalue().splitlines() == [f"[retrieve] section=bns_2023-303 parts=2,3,4,6 of 6 chars={len(h['chunk']['text'])}"]
    assert "x" * 20 not in err.getvalue()                                  # ids and numbers only, no legal text
