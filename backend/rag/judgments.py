"""Judgment retrieval (Supreme Court of India). Two stages, see DECISIONS.md.

Data (not in git), under $CHAMBERS_DATA_DIR/corpus/judgments_index/:
    cards/year=Y.jsonl                     one case card per judgment (tools/build_judgment_cards.py)
    embeddings/bge-m3/year=Y.npy           card vectors, float32, same row order
    chunks/year=Y.jsonl                    paragraph chunks (tools/build_judgment_chunks.py)
    chunk_embeddings/bge-m3/year=Y.npy     chunk vectors, float16, same row order (memory-mapped, never loaded whole)
    chunk_index/year=Y.npz                 byte offsets + case row ranges (tools/build_judgment_offsets.py)

Stage 1: cosine between the question and every case card -> the top N_CASES cases.
Stage 2: cosine between the question and the paragraph chunks of just those cases -> the best paragraphs.
Final score of a paragraph = paragraph similarity + CARD_WEIGHT * card similarity + domain boost.

Rules (CLAUDE.md): the case name, citation, year and court come from the metadata CSV via the card, and the paragraph
number from the judgment text itself; the model never writes them (rule 2). The domain tag is a soft boost, never a
filter (rule 5). Hits have the same shape as the Acts hits, so verify_citations works on them unchanged.
A case that appears in two year files is used once, the first year winning (the 2026-10-15 GPU run kept both copies).
"""
from __future__ import annotations

import glob
import json
import os
import re
from pathlib import Path
from typing import Optional

import numpy as np

DOMAIN_BOOST = 0.02
N_CASES = 50          # cases passed from stage 1 to stage 2 (12 -> 50 raised the right-case rate from .57 to .69 on the draft set)
CARD_WEIGHT = 0.5     # how much the case-level match adds to a paragraph's score (best of 0 / .25 / .5 on the draft set)
PER_CASE = 2          # at most this many paragraphs from one case, so the answer can lean on several cases
# Provisional (41 draft questions, 6 easy traps). Refuse when no returned paragraph has similarity_query >= this, i.e.
# the question as the person asked it, NOT the rewrite: a rewrite dresses up off-topic questions in legal words
# ("recipe for biryani" -> "writ petition ... jurisdiction") and would let them through. See DECISIONS.md.
JUDGMENT_REFUSAL_THRESHOLD = 0.60

_SPLIT = re.compile(r"[\s,|;]+")


def split_domains(value) -> list:
    """judgment_domains.csv separates several domains with a space ("family property"); older cards kept that as one string."""
    items = value if isinstance(value, (list, tuple)) else [value or ""]
    return sorted({d for item in items for d in _SPLIT.split(str(item)) if d})


def make_citation(case: dict, para: Optional[int]) -> str:
    """Built only from metadata fields and the paragraph number found in the judgment text."""
    name = re.sub(r"\s+", " ", case["title"]).replace(" versus ", " v. ").strip()
    reporter = case.get("citation") or case.get("case_id") or ""
    court = case.get("court") or "Supreme Court of India"
    where = f"{court}, {case['year']}" if case.get("year") else court
    out = f"{name}, {reporter} ({where})" if reporter else f"{name} ({where})"
    return f"{out}, from para {para}" if para else out


class DiskChunkStore:
    """Paragraph vectors (memory-mapped) and records (read by byte offset) for every year."""

    def __init__(self, base: Path, model_dir: str = "bge-m3"):
        self.base, self.model_dir = Path(base), model_dir
        self._vec, self._off = {}, {}

    def vectors(self, year: int):
        if year not in self._vec:
            self._vec[year] = np.load(self.base / "chunk_embeddings" / self.model_dir / f"year={year}.npy", mmap_mode="r")
        return self._vec[year]

    def record(self, year: int, row: int) -> dict:
        if year not in self._off:
            self._off[year] = np.load(self.base / "chunk_index" / f"year={year}.npz")["byte_off"]
        off = self._off[year]
        with open(self.base / "chunks" / f"year={year}.jsonl", "rb") as f:
            f.seek(int(off[row]))
            return json.loads(f.readline())


class JudgmentIndex:
    def __init__(self, cases: list, card_vectors, ranges: dict, store):
        """cases: dicts with path,title,citation,case_id,court,year,decision_date,domains(list).
        ranges: path -> (year, start_row, end_row) in that year's chunk file. store: .vectors(year), .record(year, row)."""
        assert len(cases) == len(card_vectors)
        self.cases = cases
        self.card_vectors = np.asarray(card_vectors, dtype="float32")
        self.ranges = ranges
        self.store = store
        self.domains = [set(c["domains"]) for c in cases]


def load_judgment_index(data_dir=None, model_dir: str = "bge-m3") -> JudgmentIndex:
    root = Path(data_dir or os.environ.get("CHAMBERS_DATA_DIR", "."))
    base = root / "corpus" / "judgments_index"
    cases, vecs, seen = [], [], set()
    for cf in sorted(glob.glob(str(base / "cards" / "year=*.jsonl"))):
        stem = Path(cf).stem
        ef = base / "embeddings" / model_dir / f"{stem}.npy"
        if not ef.exists():
            raise RuntimeError(f"{ef} is missing: re-run tools/build_judgment_cards.py")
        arr = np.load(ef)
        keep = []
        with open(cf, encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
        if len(rows) != len(arr):
            raise RuntimeError(f"{stem}: {len(rows)} cards but {len(arr)} vectors")
        for i, r in enumerate(rows):
            if r["path"] in seen:
                continue
            seen.add(r["path"])
            keep.append(i)
            cases.append({"path": r["path"], "title": r["title"], "citation": r.get("citation", ""),
                          "case_id": r.get("case_id", ""), "court": r.get("court", ""), "year": r["year"],
                          "decision_date": r.get("decision_date", ""), "domains": split_domains(r.get("domains"))})
        vecs.append(arr[keep])
    if not cases:
        raise RuntimeError(f"no judgment cards under {base / 'cards'}")
    ranges = {}
    for zf in sorted(glob.glob(str(base / "chunk_index" / "year=*.npz"))):
        year = int(Path(zf).stem.split("=")[1])
        z = np.load(zf)
        for p, s, e in zip(z["case_paths"].tolist(), z["case_start"].tolist(), z["case_end"].tolist()):
            ranges.setdefault(p, (year, s, e))
    if not ranges:
        raise RuntimeError(f"{base / 'chunk_index'} is empty: run tools/build_judgment_offsets.py")
    return JudgmentIndex(cases, np.concatenate(vecs), ranges, DiskChunkStore(base, model_dir))


def judgments_available(data_dir=None) -> bool:
    root = Path(data_dir or os.environ.get("CHAMBERS_DATA_DIR", "."))
    base = root / "corpus" / "judgments_index"
    return all(glob.glob(str(base / sub / "year=*")) for sub in ("cards", "chunk_index", "chunk_embeddings/bge-m3"))


def _sims(matrix, qs):
    # einsum, not `@`: see the BLAS note in retrieve.py
    return np.max([np.einsum("ij,j->i", matrix, q) for q in qs], axis=0)


def search_judgments(query: str, lawyer_domain: str, k: int, index: JudgmentIndex, embed,
                     rewritten: Optional[str] = None, n_cases: int = N_CASES, per_case: int = PER_CASE,
                     card_weight: Optional[float] = None) -> list:
    cw = CARD_WEIGHT if card_weight is None else card_weight
    texts = [query] + ([rewritten] if rewritten and rewritten != query else [])
    Q = np.asarray(embed(texts), dtype="float32")
    card_sims = _sims(index.card_vectors, Q)
    if not np.isfinite(card_sims).all():
        raise RuntimeError("non-finite similarities; check the embeddings and the numpy/BLAS install")
    boost = np.array([DOMAIN_BOOST if lawyer_domain in d else 0.0 for d in index.domains], dtype="float32")
    ranked = card_sims + boost
    n = min(n_cases, len(ranked))
    top = np.argpartition(-ranked, n - 1)[:n] if n < len(ranked) else np.arange(len(ranked))
    cand = []                                         # (score, para_sim, case_idx, year, row)
    for ci in top:
        rng = index.ranges.get(index.cases[ci]["path"])
        if not rng:
            continue                                  # a judgment with no usable text has no paragraphs
        year, s, e = rng
        block = np.asarray(index.store.vectors(year)[s:e], dtype="float32")
        psims = _sims(block, Q)                       # better of the question and its rewrite: used for ranking
        qsims = _sims(block, Q[:1])                   # the question as the person asked it: used for refusal
        best = np.argsort(-psims)[:per_case]
        for b in best:
            score = float(psims[b] + cw * card_sims[ci] + boost[ci])
            cand.append((score, float(psims[b]), float(qsims[b]), int(ci), year, s + int(b)))
    cand.sort(key=lambda t: -t[0])
    hits = []
    for score, psim, qsim, ci, year, row in cand[:k]:
        case, rec = index.cases[ci], index.store.record(year, row)
        hits.append({
            "chunk": {
                "id": rec["id"], "kind": "judgment_para", "text": rec["text"], "lang": "en",
                "domains": case["domains"], "citation": make_citation(case, rec.get("para")),
                "meta": {"case_name": case["title"], "case_citation": case["citation"], "case_id": case["case_id"],
                         "court": case["court"], "year": case["year"], "decision_date": case["decision_date"],
                         "para": rec.get("para"), "source_path": case["path"]},
            },
            "score": score, "similarity": psim, "similarity_query": qsim, "card_similarity": float(card_sims[ci]),
        })
    return hits


_jindex: Optional[JudgmentIndex] = None


def retrieve_judgments(query: str, lawyer_domain: str, k: int = 3, rewritten: Optional[str] = None) -> list:
    global _jindex
    from backend.rag import retrieve as R
    if _jindex is None:
        _jindex = load_judgment_index()
    return search_judgments(query, lawyer_domain, k, _jindex, R.get_embedder(), rewritten)


def set_judgment_index(index: Optional[JudgmentIndex]):
    global _jindex
    _jindex = index
