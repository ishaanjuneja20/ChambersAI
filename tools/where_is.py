#!/usr/bin/env python3
"""Where does a case (or a statute section) rank for a question, and why is it missing? Diagnostic only.

    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/where_is.py criminal "question" \
        --case 2014_8_128_143 --case 2022_10_351_447 --statute bnss_2023-35

Prints, for each case: card rank / similarity among ALL cards, whether it reaches stage 2 (top N_CASES), its best
paragraph similarity (question, and the judgment rewrite) and its final rank among the paragraphs. For a statute id:
its rank and similarity among all sections. Uses the live rewrite (needs GEMINI_API_KEY) unless --no-rewrite.
"""
import argparse, json, os
from pathlib import Path
import numpy as np
from backend.rag import judgments as J, retrieve as R
from backend.rag.rewrite import rewrite_query

ap = argparse.ArgumentParser()
ap.add_argument("lawyer"); ap.add_argument("question")
ap.add_argument("--case", action="append", default=[]); ap.add_argument("--statute", action="append", default=[])
ap.add_argument("--no-rewrite", action="store_true")
a = ap.parse_args()
root = Path(os.environ.get("CHAMBERS_DATA_DIR", "."))
lw = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}[a.lawyer]
rj = None if a.no_rewrite else rewrite_query(a.question, target="judgments")
rs = None if a.no_rewrite else rewrite_query(a.question)
print("judgment rewrite:", rj); print("statute rewrite :", rs)
emb = R.get_embedder()
ji = J.load_judgment_index()
Q = np.asarray(emb([a.question] + ([rj] if rj and rj != a.question else [])), dtype="float32")
card = J._sims(ji.card_vectors, Q)
boost = np.array([J.DOMAIN_BOOST if lw["domain"] in d else 0.0 for d in ji.domains], dtype="float32")
order = np.argsort(-(card + boost))
rank = {int(c): r + 1 for r, c in enumerate(order)}
paths = {c["path"]: i for i, c in enumerate(ji.cases)}
allhits = J.search_judgments(a.question, lw["domain"], 60, ji, emb, rj)
pos = {h["chunk"]["meta"]["source_path"]: i + 1 for i, h in reversed(list(enumerate(allhits)))}
for p in a.case:
    ci = paths.get(p)
    if ci is None:
        print(f"\ncase {p}: not in the card index"); continue
    c = ji.cases[ci]
    print(f"\ncase {p}  {c['title'][:60]}\n  card rank {rank[ci]} of {len(rank)} (card sim {card[ci].max():.3f}); stage 2 keeps top {J.N_CASES}"
          f" -> {'IN' if rank[ci] <= J.N_CASES else 'OUT'}")
    rng = ji.ranges.get(p)
    if rng:
        y, s, e = rng
        blk = np.asarray(ji.store.vectors(y)[s:e], dtype="float32")
        print(f"  best paragraph sim: question {J._sims(blk, Q[:1]).max():.3f}, best of question/rewrite {J._sims(blk, Q).max():.3f}")
    print("  final rank among returned paragraphs:", pos.get(p, "not in top 60"))
if a.statute:
    idx = R.load_index()
    Qs = np.asarray(emb([a.question] + ([rs] if rs and rs != a.question else [])), dtype="float64")
    sims = np.max([np.einsum("ij,j->i", idx.vectors, q) for q in Qs], axis=0)
    ids = [c["id"] for c in idx.chunks]
    order = np.argsort(-sims)
    for sid in a.statute:
        rows = [i for i, x in enumerate(ids) if x == sid or x.startswith(sid + "-p")]
        if not rows:
            print(f"\nstatute {sid}: id not found"); continue
        best = min(rows, key=lambda i: int(np.where(order == i)[0][0]))
        print(f"\nstatute {sid}: {idx.chunks[best]['citation']}  sim {sims[best]:.3f}  rank {int(np.where(order == best)[0][0]) + 1} of {len(ids)}")
