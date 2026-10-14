import numpy as np

from backend.rag import retrieve as R
from backend.rag.verify import verify_citations


def chunk(i, act, sec, domains, cit):
    return {"id": i, "kind": "act_section", "text": "t", "lang": "en", "domains": domains, "citation": cit,
            "meta": {"act": act, "act_short": act, "section": sec}}


def make():
    chunks = [chunk("bns-103", "BNS", "103", ["criminal"], "BNS s.103"),
              chunk("bns-103-p2", "BNS", "103", ["criminal"], "BNS s.103"),
              chunk("hma-13", "HMA", "13", ["family"], "HMA s.13")]
    vecs = np.array([[1, 0], [0.8, 0.6], [0.69, 0.72]], dtype="float64")
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    return R.Index(chunks, vecs), (lambda t: np.array([[0.7, 0.714]] * len(t)))


def test_one_hit_per_section_and_sorted():
    idx, emb = make()
    hits = R.search("q", "criminal", 5, idx, emb)
    assert [h["chunk"]["meta"]["section"] for h in hits].count("103") == 1
    assert hits[0]["score"] >= hits[1]["score"]


def test_domain_boost_ranks_but_never_filters():
    idx, emb = make()
    hits = R.search("q", "family", 5, idx, emb)
    assert len(hits) == 2                                    # other domain still returned
    fam = next(h for h in hits if h["chunk"]["id"] == "hma-13")
    assert abs(fam["score"] - fam["similarity"] - R.DOMAIN_BOOST) < 1e-9


def test_lang_and_thresholds():
    assert R.detect_lang("धारा 302 क्या है") == "hi" and R.detect_lang("what is murder") == "en"
    assert R.refusal_threshold("hi") < R.refusal_threshold("en")


def test_verify_drops_unknown_ids_and_uses_metadata_citation():
    idx, emb = make()
    hits = R.search("q", "criminal", 5, idx, emb)
    cid = next(h["chunk"]["id"] for h in hits if h["chunk"]["meta"]["section"] == "103")
    clean, cits, dropped = verify_citations(f"Murder is covered [{cid}] and also [bns-999].", hits)
    assert dropped == ["bns-999"] and cits == ["BNS s.103"] and "bns-999" not in clean


def test_verify_handles_grouped_ids_and_hides_internal_ids():
    hits = [{"chunk": {"id": "hma-13", "citation": "HMA s.13"}}, {"chunk": {"id": "sma-27", "citation": "SMA s.27"}}]
    clean, cits, dropped = verify_citations("Cruelty [hma-13, sma-27]. Other [zzz-1, sma-27]. Gone [nope-9]. Keep [1].", hits)
    assert cits == ["HMA s.13", "SMA s.27"] and dropped == ["zzz-1", "nope-9"]
    assert "hma-13" not in clean and "zzz-1" not in clean and "nope-9" not in clean
    assert "[HMA s.13; SMA s.27]" in clean and "[SMA s.27]" in clean and "[1]" in clean


def test_search_uses_better_of_query_and_rewrite():
    idx, _ = make()
    far = np.array([0.0, 1.0])               # close to hma-13 only
    near = np.array([1.0, 0.0])              # close to bns-103 only
    emb = lambda texts: np.array([far if t == "lay question" else near for t in texts])
    base = R.search("lay question", "criminal", 5, idx, emb)
    both = R.search("lay question", "criminal", 5, idx, emb, rewritten="legal rewrite")
    assert both[0]["similarity"] > base[0]["similarity"] or both[0]["similarity"] == 1.0
    assert both[0]["chunk"]["meta"]["section"] == "103"
