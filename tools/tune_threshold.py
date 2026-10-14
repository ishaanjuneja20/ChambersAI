#!/usr/bin/env python3
"""Pick refusal thresholds from every eval result that has per-question scores (the `top1` field).
Run from the data folder after the eval runs:
    python3 tools/tune_threshold.py --root . --match rewrite-max
Pools all matching result files (e.g. bge-m3+rewrite-max and bge-m3+rewrite-max@lay) and prints, per language,
the share of real questions kept and traps refused at several thresholds, plus the best balanced one.
"""
import argparse, json
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=".")
ap.add_argument("--match", default="rewrite-max")
a = ap.parse_args()
rows = []
used = []
for p in sorted((Path(a.root) / "corpus" / "eval").glob("*.json")):
    if p.name.startswith("rewrites_") or a.match not in p.name:
        continue
    r = json.loads(p.read_text())
    if "top1" in r:
        rows += r["top1"]
        used.append(p.name)
print("pooling:", used)
for lang in ("en", "hi"):
    ans = sorted(x["s"] for x in rows if x["lang"] == lang and x["type"] == "answerable")
    trp = sorted(x["s"] for x in rows if x["lang"] == lang and x["type"] == "trap")
    if not ans or not trp:
        continue
    cands = sorted(set(round(v, 3) for v in ans + trp))
    def stats(t):
        return sum(v >= t for v in ans) / len(ans), sum(v < t for v in trp) / len(trp)
    best = max(cands, key=lambda t: sum(stats(t)) / 2)
    print(f"\n== {lang}: {len(ans)} answerable, {len(trp)} traps; best balanced threshold {best}")
    print("threshold  kept   traps_refused")
    for t in [x / 1000 for x in range(540, 700, 10)]:
        k, tr = stats(t)
        mark = "  <== best" if abs(t - best) < 0.005 else ""
        print(f"  {t:.3f}   {k:.2f}   {tr:.2f}{mark}")
    print("lowest answerable scores:", [round(v, 3) for v in ans[:5]])
    print("highest trap scores:     ", [round(v, 3) for v in trp[-5:]])
