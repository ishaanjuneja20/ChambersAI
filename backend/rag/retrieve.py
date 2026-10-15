"""Real retriever (bge-m3). Format: docs/CONTRACTS.md.

Data (not in git) is read from $CHAMBERS_DATA_DIR (default: ./data_dir fallback to cwd):
    corpus/chunks/acts/*.jsonl            chunks (tools/chunk_acts.py + apply_citation_map.py)
    corpus/embeddings/bge-m3/docs.npy     one L2-normalised row per chunk (tools/eval_embeddings.py)
    corpus/embeddings/bge-m3/ids.json     chunk ids in row order

Behaviour (decided from the eval, see DECISIONS.md):
  * cosine similarity between the query and each chunk
  * one hit per section (best chunk), because long sections are split into several chunks
  * domain tag adds DOMAIN_BOOST to the ranking score; it never filters (CLAUDE.md rule 5)
  * every hit carries `similarity` (raw, used for refusal) and `score` (boosted, used for ranking)
  * `refusal_threshold(lang)` gives the per-language cut-off below which we refuse (rule 4)
Citations are read from chunk metadata only (rule 2).
"""
from __future__ import annotations
import glob
import json
import os
import re
from pathlib import Path

import numpy as np

MODEL_NAME = "BAAI/bge-m3"
DOMAIN_BOOST = 0.02
# Tuned with tools/tune_threshold.py on the two DRAFT test sets pooled (not lawyer reviewed), WITH query rewriting on:
# EN 0.64 keeps 92% of real questions / refuses 93% of traps; HI 0.60 keeps 96% / refuses 86%.
# Tilted towards answering: the Gemini step ("no source" -> no citation -> refuse) is a second guard.
# Without the rewrite step, scores are lower: re-tune if rewriting is switched off (CHAMBERS_REWRITE=0).
REFUSAL_THRESHOLDS = {"en": 0.64, "hi": 0.60}
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")

_index = None          # lazily loaded Index
_embedder = None       # callable: list[str] -> np.ndarray (n, d), L2-normalised


def detect_lang(text: str) -> str:
    return "hi" if _DEVANAGARI.search(text) else "en"


def refusal_threshold(lang: str) -> float:
    return REFUSAL_THRESHOLDS.get(lang, max(REFUSAL_THRESHOLDS.values()))


class Index:
    def __init__(self, chunks, vectors):
        assert len(chunks) == len(vectors)
        self.chunks = chunks
        self.vectors = np.asarray(vectors, dtype="float64")
        self.keys = [self._key(c) for c in chunks]
        self.domains = [set(c.get("domains") or []) for c in chunks]

    @staticmethod
    def _key(c):
        m = c["meta"]
        return f'{m.get("act_short") or m.get("act")}:{m.get("section")}' if m.get("section") else c["id"]


def load_index(data_dir=None, model_dir="bge-m3") -> Index:
    root = Path(data_dir or os.environ.get("CHAMBERS_DATA_DIR", "."))
    by_id = {}
    for f in sorted(glob.glob(str(root / "corpus" / "chunks" / "acts" / "*.jsonl"))):
        for line in open(f, encoding="utf-8"):
            c = json.loads(line)
            by_id[c["id"]] = c
    emb = root / "corpus" / "embeddings" / model_dir
    ids = json.loads((emb / "ids.json").read_text())
    vectors = np.load(emb / "docs.npy")
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise RuntimeError(f"{len(missing)} embedded chunk ids not in chunk files (e.g. {missing[:3]}); "
                           "re-run tools/eval_embeddings.py --models bge-m3 after re-chunking")
    return Index([by_id[i] for i in ids], vectors)


def _default_embedder():
    from sentence_transformers import SentenceTransformer
    # CPU on purpose: on Apple MPS short queries get wrong vectors (BNS 103 scored 0.21 instead of 0.71 for
    # "punishment for murder"). One short query is fast on CPU. Override with CHAMBERS_DEVICE if needed.
    model = SentenceTransformer(MODEL_NAME, device=os.environ.get("CHAMBERS_DEVICE", "cpu"))
    model.max_seq_length = 512
    return lambda texts: model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def set_backend(index=None, embedder=None):
    """Inject an index/embedder (tests, or to preload at server start)."""
    global _index, _embedder
    _index, _embedder = index, embedder


def get_embedder():
    """The shared query embedder (loads bge-m3 on first use); judgments.py reuses it so the model is loaded once."""
    global _embedder
    if _embedder is None:
        _embedder = _default_embedder()
    return _embedder


def search(query: str, lawyer_domain: str, k: int, index: Index, embed, rewritten: str | None = None) -> list[dict]:
    """`rewritten` is an optional English legal rewrite of the question; each section keeps its better score."""
    texts = [query] + ([rewritten] if rewritten and rewritten != query else [])
    Q = np.asarray(embed(texts), dtype="float64")
    # einsum, not `@`: numpy 2.0 + Apple Accelerate on some Macs returns garbage from BLAS matmul (warnings
    # 'divide by zero / overflow in matmul'). The corpus is small, so the plain loop is fast enough.
    sims = np.max([np.einsum("ij,j->i", index.vectors, q) for q in Q], axis=0)
    if not np.isfinite(sims).all():
        raise RuntimeError("non-finite similarities; check the embeddings and the numpy/BLAS install")
    best = {}                                    # section key -> chunk row with the highest similarity
    for i, key in enumerate(index.keys):
        if key not in best or sims[i] > sims[best[key]]:
            best[key] = i
    hits = []
    for i in best.values():
        boost = DOMAIN_BOOST if lawyer_domain in index.domains[i] else 0.0
        hits.append({"chunk": index.chunks[i], "score": float(sims[i] + boost), "similarity": float(sims[i])})
    hits.sort(key=lambda h: -h["score"])
    return hits[:k]


def retrieve(query: str, lawyer_domain: str, k: int = 5, rewritten: str | None = None) -> list[dict]:
    global _index, _embedder
    if _index is None:
        _index = load_index()
    if _embedder is None:
        _embedder = _default_embedder()
    return search(query, lawyer_domain, k, _index, _embedder, rewritten)
