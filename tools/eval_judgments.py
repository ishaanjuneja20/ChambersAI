#!/usr/bin/env python3
"""Measure judgment retrieval on tests/eval/judgment_questions.json (DRAFT questions, not lawyer reviewed).

Run from the data folder on the Mac (needs numpy, sentence-transformers; torch is used for the brute-force scan):
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/eval_judgments.py --root .
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/eval_judgments.py --root . --no-brute     # skip the 2.7 GB scan

Reports, for the find-the-case and point questions:
  * stage 1 recall: is the right case among the top N cards, for N = 5, 12, 25, 50 (this caps what stage 2 can find)
  * the two-stage search for several (n_cases, card_weight) settings: right case in the top 5 hits; for point
    questions also whether a gold paragraph is in the top 5
  * a brute-force upper bound: every one of the 1.41M paragraphs scored, no cards at all
  * best paragraph similarity of real questions vs traps, to choose the refusal threshold
Writes corpus/eval/judgments_<date>.json. Question text is not sent anywhere.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from backend.rag import judgments as J
from backend.rag import retrieve as R


def case_of(chunk_id: str) -> str:
    return chunk_id[3:].rsplit("#", 1)[0]


def brute_force(index, Q, k=5, groups=None):
    """Top-k paragraphs over everything, per query. Q: (nrows, d) float32. groups[i] = the rows of Q that belong to
    query i (the question and its rewrite; the better score counts). Only cases that survive the dedupe count."""
    groups = groups or [[i] for i in range(len(Q))]
    try:
        import torch
        Qt = torch.from_numpy(Q)
        scores = lambda block: (torch.from_numpy(block) @ Qt.T).numpy()      # torch: numpy's BLAS is unreliable on some Macs
    except ImportError:
        scores = lambda block: np.einsum("rd,qd->rq", block, Q)
    top = [[] for _ in range(len(groups))]
    for year in sorted({y for y, _, _ in index.ranges.values()}):
        vecs = index.store.vectors(year)
        keep = [(p, s, e) for p, (y, s, e) in index.ranges.items() if y == year]
        for p, s, e in keep:                       # per case so repeated cases are never scored twice
            sims = scores(np.asarray(vecs[s:e], dtype="float32"))   # (rows, nq)
            for qi, g in enumerate(groups):
                col = sims[:, g].max(axis=1)
                j = int(np.argmax(col))
                top[qi].append((float(col[j]), p, j))
        for qi in range(len(groups)):
            top[qi] = sorted(top[qi], reverse=True)[:k]
    return top


def load_queries(qs, embed, root, rewrite):
    """Returns (Q rows, groups, rows_of). With rewrite, each question gets a second row: its English legal rewrite
    (cached in corpus/eval/judgment_rewrites.json so a re-run costs nothing)."""
    texts = [q["question"] for q in qs]
    rew = {}
    if rewrite:
        from backend.rag.rewrite import rewrite_query
        cache = Path(root) / "corpus" / "eval" / "judgment_rewrites.json"
        old = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
        for q in qs:
            if old.get(q["id"], q["question"]) == q["question"]:      # missing, or an earlier failed call
                got = rewrite_query(q["question"], target="judgments")
                if got != q["question"]:                               # a failed call returns the question unchanged: don't cache it
                    old[q["id"]] = got
            rew[q["id"]] = old.get(q["id"], q["question"])
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")
        changed = sum(1 for q in qs if rew[q["id"]] != q["question"])
        print(f"rewrites obtained: {changed} of {len(qs)}", flush=True)
        if changed == 0:
            sys.exit("No rewrite came back. Is GEMINI_API_KEY a real key (not the placeholder), and is the Gemini API reachable? Nothing was tested.")
        if changed < len(qs) * 0.8:
            print("WARNING: many rewrites failed; the numbers below mix rewritten and plain questions", flush=True)
    all_texts, groups = list(texts), [[i] for i in range(len(texts))]
    for i, q in enumerate(qs):
        r = rew.get(q["id"])
        if r and r != q["question"]:
            groups[i].append(len(all_texts))
            all_texts.append(r)
    Q = np.asarray(embed(all_texts), dtype="float32")
    # search_judgments embeds [query] or [query, rewritten]; hand back the matching rows
    return Q, groups, (lambda i, t: Q[groups[i][:len(t)]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--questions", default=None)
    ap.add_argument("--no-brute", action="store_true")
    ap.add_argument("--rewrite", action="store_true",
                    help="also search with a Gemini rewrite of each question (needs GEMINI_API_KEY; sends the TEST questions only)")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    qpath = Path(a.questions) if a.questions else Path(__file__).resolve().parents[1] / "tests" / "eval" / "judgment_questions.json"
    if not qpath.exists():
        qpath = root / "tests" / "eval" / "judgment_questions.json"
    qs = json.loads(qpath.read_text(encoding="utf-8"))

    t0 = time.time()
    index = J.load_judgment_index(root)
    embed = R.get_embedder()
    Q, groups, rows_of = load_queries(qs, embed, root, a.rewrite)
    print(f"index + embeddings {time.time() - t0:.0f}s; {len(qs)} questions", flush=True)

    real = [(i, q) for i, q in enumerate(qs) if q["type"] != "trap"]
    traps = [(i, q) for i, q in enumerate(qs) if q["type"] == "trap"]
    out = {"n_questions": len(qs), "stage1": {}, "two_stage": {}, "brute": {}, "threshold": {}}

    # stage 1 recall
    card_sims = [np.max([np.einsum("ij,j->i", index.card_vectors, Q[r]) for r in groups[i]], axis=0) for i, _ in real]
    paths = [c["path"] for c in index.cases]
    for n in (5, 12, 25, 50):
        hit = 0
        for (i, q), s in zip(real, card_sims):
            top = {paths[j] for j in np.argsort(-s)[:n]}
            hit += q["gold_cases"][0] in top
        out["stage1"][n] = hit / len(real)
    print("\nStage 1 (cards only): right case among top N cards")
    for n, v in out["stage1"].items():
        print(f"  top {n:>2}: {v:.2f}")
    for (i, q), s in zip(real, card_sims):
        rank = int((s > s[paths.index(q["gold_cases"][0])]).sum()) + 1
        if rank > 12:
            print(f"    miss at 12: {q['id']} rank {rank}: {q['question'][:70]}")

    # two-stage settings
    print("\nTwo-stage: right case in top 5 hits (case) / gold paragraph in top 5 (para, point questions)")
    for n_cases in (5, 12, 25, 50):
        for cw in (0.0, 0.25, 0.5):
            case_hit = para_hit = n_point = 0
            for i, q in real:
                hits = J.search_judgments(q["question"], q["lawyer"], 5, index, lambda t, i=i: rows_of(i, t),
                                          n_cases=n_cases, card_weight=cw)
                ids = [h["chunk"]["id"] for h in hits]
                case_hit += q["gold_cases"][0] in {case_of(x) for x in ids}
                if q["type"] == "point":
                    n_point += 1
                    para_hit += bool(set(ids) & set(q["gold_chunks"]))
            out["two_stage"][f"n{n_cases}_w{cw}"] = {"case": case_hit / len(real), "para": para_hit / max(n_point, 1)}
            print(f"  cases {n_cases:>2}  card weight {cw:.2f}:  case {case_hit / len(real):.2f}   para {para_hit / max(n_point, 1):.2f}")

    # brute force upper bound
    if not a.no_brute:
        t1 = time.time()
        top = brute_force(index, Q, groups=groups)
        ch = ph = npnt = 0
        for i, q in real:
            ids = [f"sc-{p}#{j}" for _, p, j in top[i]]
            ch += q["gold_cases"][0] in {case_of(x) for x in ids}
            if q["type"] == "point":
                npnt += 1
                ph += bool(set(ids) & set(q["gold_chunks"]))
        out["brute"] = {"case": ch / len(real), "para": ph / max(npnt, 1)}
        print(f"\nBrute force over all paragraphs ({time.time() - t1:.0f}s): case {ch / len(real):.2f}   para {ph / max(npnt, 1):.2f}")

    # thresholds: best paragraph similarity from the default two-stage search
    def best_sim(i, q):
        h = J.search_judgments(q["question"], q["lawyer"], 1, index, lambda t, i=i: rows_of(i, t))
        return h[0]["similarity"] if h else 0.0
    real_s = sorted(best_sim(i, q) for i, q in real)
    trap_s = sorted(best_sim(i, q) for i, q in traps)
    out["threshold"] = {"real": real_s, "traps": trap_s}
    print("\nRefusal threshold: share of real questions kept / traps refused")
    for t in [x / 100 for x in range(40, 76, 4)]:
        print(f"  {t:.2f}: kept {sum(v >= t for v in real_s) / len(real_s):.2f}   refused {sum(v < t for v in trap_s) / max(len(trap_s), 1):.2f}")
    print("lowest real:", [round(v, 3) for v in real_s[:5]], " highest trap:", [round(v, 3) for v in trap_s[-3:]])

    d = root / "corpus" / "eval"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"judgments_{time.strftime('%Y%m%d_%H%M')}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
