import importlib.util
import json
import pathlib
import sys

import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "tools"))
from backend.rag import judgments as J  # noqa: E402
from backend.rag.verify import verify_citations  # noqa: E402

_spec = importlib.util.spec_from_file_location("build_judgment_offsets", root / "tools" / "build_judgment_offsets.py")
off = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(off)


def unit(v):
    v = np.asarray(v, dtype="float32")
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


CASES = [
    {"path": "2001_1_1_9", "title": "RAM versus STATE", "citation": "[2001] 1 S.C.R. 1", "case_id": "2001 INSC 1",
     "court": "Supreme Court of India", "year": 2001, "decision_date": "01-01-2001", "domains": ["criminal"]},
    {"path": "2002_1_1_9", "title": "SITA versus HARI", "citation": "", "case_id": "2002 INSC 7",
     "court": "Supreme Court of India", "year": 2002, "decision_date": "01-01-2002", "domains": ["family"]},
    {"path": "2003_1_1_9", "title": "NO TEXT CASE", "citation": "x", "case_id": "", "court": "", "year": 2003,
     "decision_date": "", "domains": ["other"]},
]
CARD = unit([[1, 0, 0], [0, 1, 0], [0, 0, 1]])


class MemStore:
    def __init__(self):
        # year -> rows (vector, record)
        self.v = {2001: unit([[1, 0, 0], [0.6, 0.8, 0], [0.9, 0.1, 0]]), 2002: unit([[0, 1, 0], [0.1, 0.9, 0]])}
        self.r = {2001: [{"id": "sc-2001_1_1_9#0", "para": 5, "text": "murder para"},
                         {"id": "sc-2001_1_1_9#1", "para": None, "text": "other para"},
                         {"id": "sc-2001_1_1_9#2", "para": 7, "text": "near murder para"}],
                  2002: [{"id": "sc-2002_1_1_9#0", "para": 1, "text": "divorce para"},
                         {"id": "sc-2002_1_1_9#1", "para": 2, "text": "maintenance para"}]}

    def vectors(self, year):
        return self.v[year]

    def record(self, year, row):
        return self.r[year][row]


def make_index():
    ranges = {"2001_1_1_9": (2001, 0, 3), "2002_1_1_9": (2002, 0, 2)}
    return J.JudgmentIndex(CASES, CARD, ranges, MemStore())


def embed_murder(texts):
    return np.array([[1, 0, 0]] * len(texts), dtype="float32")


def test_best_paragraph_of_best_case_comes_first_with_metadata_citation():
    hits = J.search_judgments("q", "", 3, make_index(), embed_murder)
    assert hits[0]["chunk"]["id"] == "sc-2001_1_1_9#0"
    assert hits[0]["chunk"]["citation"] == "RAM v. STATE, [2001] 1 S.C.R. 1 (Supreme Court of India, 2001), from para 5"
    assert hits[0]["chunk"]["meta"]["para"] == 5 and hits[0]["similarity"] > 0.99


def test_per_case_limit_and_case_without_text_is_skipped():
    hits = J.search_judgments("q", "", 10, make_index(), embed_murder, per_case=2)
    ids = [h["chunk"]["id"] for h in hits]
    assert sum(i.startswith("sc-2001") for i in ids) == 2
    assert not any("2003" in i for i in ids)


def test_domain_boost_ranks_but_never_filters():
    q = lambda t: unit([[0.7, 0.714, 0]] * len(t))
    plain = J.search_judgments("q", "", 5, make_index(), q)
    fam = J.search_judgments("q", "family", 5, make_index(), q)
    assert {h["chunk"]["id"] for h in fam} == {h["chunk"]["id"] for h in plain}      # nothing filtered out
    top = next(h for h in fam if h["chunk"]["id"] == "sc-2002_1_1_9#0")
    base = next(h for h in plain if h["chunk"]["id"] == "sc-2002_1_1_9#0")
    assert abs(top["score"] - base["score"] - J.DOMAIN_BOOST) < 1e-6


def test_citation_without_scr_uses_case_id_and_no_para():
    assert J.make_citation(CASES[1], None) == "SITA v. HARI, 2002 INSC 7 (Supreme Court of India, 2002)"


def test_split_domains_handles_space_separated_values():
    assert J.split_domains(["family property"]) == ["family", "property"]
    assert J.split_domains("criminal, labour") == ["criminal", "labour"] and J.split_domains(None) == []


def test_hits_work_with_verify_citations():
    hits = J.search_judgments("q", "", 2, make_index(), embed_murder)
    cid = hits[0]["chunk"]["id"]
    text, cites, dropped = verify_citations(f"The court held this [{cid}] and that [sc-9999_1_1_9#0].", hits)
    assert cites == [hits[0]["chunk"]["citation"]] and dropped == ["sc-9999_1_1_9#0"]
    assert "sc-9999" not in text and cid not in text


def write_chunks(path, rows):
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def chunk_row(p, i, text="t"):
    return {"case_id": "sc-" + p, "path": p, "id": f"sc-{p}#{i}", "para": i, "text": text}


def test_offsets_keep_first_copy_of_a_case_across_years(tmp_path):
    f1, f2 = tmp_path / "year=1951.jsonl", tmp_path / "year=1952.jsonl"
    write_chunks(f1, [chunk_row("a", 0), chunk_row("a", 1), chunk_row("b", 0)])
    write_chunks(f2, [chunk_row("b", 0), chunk_row("c", 0, "ünï")])
    seen = set()
    offs1, p1, s1, e1 = off.index_year(str(f1), seen)
    offs2, p2, s2, e2 = off.index_year(str(f2), seen)
    assert (p1, s1, e1) == (["a", "b"], [0, 2], [2, 3])
    assert (p2, s2, e2) == (["c"], [1], [2])            # "b" was already kept in 1951
    data = f2.read_bytes()
    assert json.loads(data[offs2[1]:offs2[2]])["id"] == "sc-c#0"


def test_disk_round_trip(tmp_path):
    base = tmp_path / "corpus" / "judgments_index"
    for d in ("cards", "embeddings/bge-m3", "chunks", "chunk_embeddings/bge-m3", "chunk_index"):
        (base / d).mkdir(parents=True)
    rows = {2001: [chunk_row("2001_1_1_9", 0, "murder para"), chunk_row("2001_1_1_9", 1, "x")],
            2002: [chunk_row("2002_1_1_9", 0, "divorce para")]}
    vecs = {2001: unit([[1, 0, 0], [0, 0, 1]]), 2002: unit([[0, 1, 0]])}
    seen = set()
    for y in (2001, 2002):
        write_chunks(base / "chunks" / f"year={y}.jsonl", rows[y])
        np.save(base / "chunk_embeddings" / "bge-m3" / f"year={y}.npy", vecs[y].astype("float16"))
        o, p, s, e = off.index_year(str(base / "chunks" / f"year={y}.jsonl"), seen)
        np.savez(base / "chunk_index" / f"year={y}.npz", byte_off=np.array(o), case_paths=np.array(p),
                 case_start=np.array(s), case_end=np.array(e))
        cards = [dict(c, card="x") for c in CASES if c["year"] == y]
        cards += [dict(CASES[0], card="x")] if y == 2002 else []        # duplicate of the 2001 case in the 2002 file
        (base / "cards" / f"year={y}.jsonl").write_text("".join(json.dumps(c) + "\n" for c in cards), encoding="utf-8")
        np.save(base / "embeddings" / "bge-m3" / f"year={y}.npy", unit(np.tile([1, 0, 0], (len(cards), 1))))
    assert J.judgments_available(tmp_path)
    idx = J.load_judgment_index(tmp_path)
    assert [c["path"] for c in idx.cases] == ["2001_1_1_9", "2002_1_1_9"]       # duplicate card dropped
    hits = J.search_judgments("q", "", 2, idx, embed_murder)
    assert hits[0]["chunk"]["text"] == "murder para" and hits[0]["chunk"]["meta"]["source_path"] == "2001_1_1_9"


def test_rewrite_prompt_switches_to_judgments_and_does_not_leak_test_topics():
    from backend.rag import rewrite as W
    seen = {}

    def fake(body, post, model=None):
        seen["prompt"] = body["contents"][0]["parts"][0]["text"]
        return "some query"

    orig = W.call_gemini
    W.call_gemini = fake
    try:
        W.rewrite_query("q", target="judgments")
        assert "Supreme Court of India judgments" in seen["prompt"]
        W.rewrite_query("q")
        assert "Indian statutes" in seen["prompt"]
    finally:
        W.call_gemini = orig
    # the example topics in the judgment prompt must not be topics of the test questions
    import json
    qs = " ".join(q["question"].lower() for q in json.load(open(root / "tests" / "eval" / "judgment_questions.json")))
    for word in ("salary", "wall", "landlord", "tenant", "eviction"):
        assert word not in qs
