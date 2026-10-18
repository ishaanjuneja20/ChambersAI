#!/usr/bin/env python3
"""How much does the Gemini rewrite change which statute sections come back?

    export GEMINI_API_KEY=...
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/rewrite_stability.py --root . [--lang hi] [--runs 4]

For every answerable question in tests/eval/questions.json (default: Hindi) it asks Gemini for several rewrites
(cached in corpus/eval/stability_rewrites.json) and reports, per strategy, how often a gold section is in the
top 5 (hit@5) and in the top 3:

  question only            the question as asked
  rewrite only             each rewrite alone (averaged over runs)
  question+rewrite (now)   what the app does: better score per section (averaged over runs, and WORST run)
  question+all rewrites    better score over the question and every rewrite together (candidate fix)

Questions whose result changes between runs are listed, with the sections that came back, so a flaky rewrite is
visible. Question text stays on this machine except for the Gemini rewrite calls the app also makes.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.rag import retrieve as R  # noqa: E402
from backend.rag.rewrite import rewrite_query  # noqa: E402

BOOST = R.DOMAIN_BOOST


def ranked_keys(index, sims, lawyer):
    best = {}
    for i, key in enumerate(index.keys):
        if key not in best or sims[i] > sims[best[key]]:
            best[key] = i
    sc = {k: float(sims[i]) + (BOOST if lawyer in index.domains[i] else 0.0) for k, i in best.items()}
    return sorted(sc, key=lambda k: -sc[k])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--lang", default="hi")
    ap.add_argument("--runs", type=int, default=4)
    ap.add_argument("--delay", type=float, default=0.7)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    qs = [q for q in json.loads((root / "tests/eval/questions.json").read_text(encoding="utf-8"))
          if q["type"] == "answerable" and q["lang"] == a.lang]
    cache_path = root / "corpus" / "eval" / "stability_rewrites.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    for q in qs:
        have = cache.setdefault(q["id"], [])
        while len(have) < a.runs:
            rw = rewrite_query(q["question"])
            if rw == q["question"]:                       # call failed and fell back: do not cache
                print(f"  rewrite failed for {q['id']}; waiting", flush=True)
                time.sleep(5)
                continue
            have.append(rw)
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            time.sleep(a.delay)

    index = R.load_index(root)
    embed = R.get_embedder()
    stats = {k: {3: [], 5: []} for k in ("question only", "rewrite only", "question+rewrite (now)",
                                         "question+rewrite WORST run", "question+all rewrites")}
    flaky = []
    for q in qs:
        rws = cache[q["id"]][: a.runs]
        E = np.asarray(embed([q["question"]] + rws), dtype="float64")
        S = [np.einsum("ij,j->i", index.vectors, e) for e in E]

        def hit(sims):
            order = ranked_keys(index, sims, q["lawyer"])[:5]
            r = next((i + 1 for i, k in enumerate(order) if k in q["gold"]), None)
            return r, order

        def record(name, results):
            for n in (3, 5):
                stats[name][n].append(float(np.mean([1 if r and r <= n else 0 for r, _ in results])))

        record("question only", [hit(S[0])])
        record("rewrite only", [hit(s) for s in S[1:]])
        now = [hit(np.maximum(S[0], s)) for s in S[1:]]
        record("question+rewrite (now)", now)
        for n in (3, 5):
            stats["question+rewrite WORST run"][n].append(min(1 if r and r <= n else 0 for r, _ in now))
        record("question+all rewrites", [hit(np.max(S, axis=0))])
        if len({bool(r and r <= 5) for r, _ in now}) > 1:
            flaky.append((q, rws, now))

    print(f"\n{len(qs)} {a.lang} answerable questions, {a.runs} rewrites each\n")
    print(f"{'strategy':32s} hit@3  hit@5")
    for name, s in stats.items():
        print(f"{name:32s} {np.mean(s[3]):.2f}   {np.mean(s[5]):.2f}")
    if flaky:
        print(f"\n{len(flaky)} questions where the rewrite decides whether the gold section is in the top 5:")
        for q, rws, now in flaky:
            print(f"\n[{q['id']}] gold {q['gold']}")
            for rw, (r, order) in zip(rws, now):
                print(f"   {'HIT ' if r and r <= 5 else 'MISS'} {rw[:70]!r} -> {', '.join(o.split(':')[-1] for o in order)}")


if __name__ == "__main__":
    main()
