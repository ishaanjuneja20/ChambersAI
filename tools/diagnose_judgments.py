#!/usr/bin/env python3
"""For each judgment test question whose gold case is NOT in the top 5, show what came back instead.

    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/diagnose_judgments.py --root .            # misses only
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/diagnose_judgments.py --root . --all      # every question

Per question: rank of the gold case among the case cards, the gold case's best paragraph similarity and rank
(over every paragraph), then the top 5 hits of the search (case name, paragraph similarity, card similarity).
This tells whether a miss is a real failure (nothing relevant came back) or a strict gold label (other good
cases came back). Question text stays on this machine; nothing is sent anywhere.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend.rag import judgments as J  # noqa: E402
from backend.rag import retrieve as R  # noqa: E402
from eval_judgments import brute_force, case_of, load_queries  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--questions", default=None)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--rewrite", action="store_true", help="also search with the Gemini rewrite (needs GEMINI_API_KEY)")
    ap.add_argument("--n-cases", type=int, default=50)
    ap.add_argument("--card-weight", type=float, default=0.5)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    qpath = Path(a.questions) if a.questions else root / "tests" / "eval" / "judgment_questions.json"
    qs = [q for q in json.loads(qpath.read_text(encoding="utf-8")) if q["type"] != "trap"]
    index = J.load_judgment_index(root)
    embed = R.get_embedder()
    Q, groups, rows_of = load_queries(qs, embed, root, a.rewrite)
    paths = [c["path"] for c in index.cases]
    title = {c["path"]: f'{c["title"][:48]} ({c["year"]})' for c in index.cases}
    brute = brute_force(index, Q, k=10, groups=groups)
    shown = 0
    for i, q in enumerate(qs):
        gold = q["gold_cases"][0]
        hits = J.search_judgments(q["question"], q["lawyer"], 5, index, lambda t, i=i: rows_of(i, t),
                                  n_cases=a.n_cases, card_weight=a.card_weight)
        got = [case_of(h["chunk"]["id"]) for h in hits]
        if gold in got and not a.all:
            continue
        shown += 1
        cs = np.max([np.einsum("ij,j->i", index.card_vectors, Q[r]) for r in groups[i]], axis=0)
        gi = paths.index(gold)
        rank = int((cs > cs[gi]).sum()) + 1
        y, s, e = index.ranges[gold]
        ps = np.max([np.einsum("rd,d->r", np.asarray(index.store.vectors(y)[s:e], dtype="float32"), Q[r]) for r in groups[i]], axis=0)
        print(f"\n[{q['id']}] {q['question']}")
        print(f"  gold: {title.get(gold, gold)}  card rank {rank} (sim {cs[gi]:.3f})  best paragraph sim {ps.max():.3f}")
        print("  brute-force top cases: " + "; ".join(f"{title[p][:30]} {sim:.2f}" for sim, p, _ in brute[i][:3]))
        for h in hits:
            m = h["chunk"]["meta"]
            mark = "  <== gold" if m["source_path"] == gold else ""
            print(f"  {h['similarity']:.3f}/{h['card_similarity']:.3f}  {title[m['source_path']]}{mark}\n      {h['chunk']['text'][:150]}")
    print(f"\n{shown} questions shown")


if __name__ == "__main__":
    main()
