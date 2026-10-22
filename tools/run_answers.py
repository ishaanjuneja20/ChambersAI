#!/usr/bin/env python3
"""Run the 55 judgment test questions through the real answer() and save what came out, so two versions of the
code can be compared. ~13 s per question (the free Gemini key allows 15 calls a minute, a question uses 3).

    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/run_answers.py baseline            -> corpus/eval/answers_baseline.json
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/run_answers.py after --ids f03 t17   (only some questions)
    python3 tools/run_answers.py --compare baseline after                                (what changed, no model needed)
"""
import argparse, json, os, sys, time
from pathlib import Path

root = Path(os.environ.get("CHAMBERS_DATA_DIR", "."))
EVAL = root / "corpus" / "eval"


def load(tag):
    return {r["id"]: r for r in json.loads((EVAL / f"answers_{tag}.json").read_text(encoding="utf-8"))}


def state(r):
    if r is None:
        return "-"
    if r.get("error"):
        return "ERROR"
    return "refused" if r["refused"] else "answered"


def subqueries(r):
    """Number of sub-queries the statute rewrite produced for this question, '-' if the run did not record it."""
    sub = (r.get("debug") or {}).get("subqueries")
    return "-" if sub is None else len(sub)


def compare(a_tag, b_tag):
    a, b = load(a_tag), load(b_tag)
    kinds = {}
    for i in a:
        if i in b:
            typ = "answerable" if a[i]["type"] == "scenario" else a[i]["type"]       # scenario questions count as answerable
            kinds.setdefault((typ, state(a[i]), state(b[i])), []).append(i)
    print(f"{a_tag} -> {b_tag}")
    for (typ, sa, sb), ids in sorted(kinds.items()):
        print(f"  {typ:10s} {sa:9s} -> {sb:9s} {len(ids):3d}  {' '.join(ids) if sa != sb else ''}")
    print("\nanswered in both, citations changed:")
    for i in a:
        if i in b and state(a[i]) == state(b[i]) == "answered" and a[i]["citations"] != b[i]["citations"]:
            print(f"  {i}: {len(a[i]['citations'])} -> {len(b[i]['citations'])} citations")
    print("\nsub-queries used per question (CHAMBERS_MULTIQUERY; '-' = not recorded in that run):")
    for i in a:
        if i in b:
            print(f"  {i:8s} {state(a[i]):9s} -> {state(b[i]):9s} sub-queries {subqueries(a[i])} -> {subqueries(b[i])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tag", nargs="?")
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--compare", nargs=2)
    ap.add_argument("--tally", nargs="+", help="show answered/refused per question across several saved runs")
    ap.add_argument("--questions", default="tests/eval/judgment_questions.json", help="question set to run")
    ap.add_argument("--pause", type=float, default=13.0)
    ap.add_argument("--resume", action="store_true", help="keep answers already saved under this tag, run only the rest")
    a = ap.parse_args()
    if a.compare:
        return compare(*a.compare)
    if a.tally:
        runs = [load(t) for t in a.tally]
        print("id    " + " ".join(f"{t[-8:]:>8s}" for t in a.tally))
        for i in runs[0]:
            row = [state(r.get(i)) for r in runs]
            print(f"{i:5s} " + " ".join(f"{x:>8s}" for x in row) + ("   <- differs" if len(set(row)) > 1 else ""))
        return
    os.environ["CHAMBERS_DEBUG"] = "1"
    from backend.rag.generate import GenerationError
    from backend.rag.pipeline import answer, warmup
    lawyers = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}
    qs = json.loads((root / a.questions).read_text(encoding="utf-8"))
    if a.ids:
        qs = [q for q in qs if q["id"] in a.ids]
    out_path = EVAL / f"answers_{a.tag}.json"
    done = {r["id"]: r for r in json.loads(out_path.read_text(encoding="utf-8"))} if out_path.exists() and (a.ids or a.resume) else {}
    if a.resume:
        qs = [q for q in qs if q["id"] not in done]
    warmup()
    for n, q in enumerate(qs, 1):
        t0 = time.time()
        row = {"id": q["id"], "type": q["type"], "lang": q["lang"], "question": q["question"]}
        if os.environ.get("CHAMBERS_TRACE"):
            print(f"[eval] {q['id']}", file=sys.stderr, flush=True)          # lets a saved trace be split per question
        try:
            lw = lawyers.get(q["lawyer"]) or {"id": "", "domain": "", "name": "TBD", "personality": "TBD"}   # traps have no lawyer
            r = answer(q["question"], lw, q["lang"])
            row.update(refused=r["refused"], answer=r["answer"], citations=r["citations"],
                       reason=(r.get("debug") or {}).get("reason"), debug=r.get("debug"))
        except GenerationError as e:
            row.update(error=str(e), refused=True, answer="", citations=[])
        row["wall_seconds"] = round(time.time() - t0, 1)
        done[q["id"]] = row
        out_path.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[{n}/{len(qs)}] {q['id']}: {state(row)} {row['wall_seconds']}s" + (f" ({row.get('reason')})" if row["refused"] else f" {len(row['citations'])} cites"),
              flush=True)
        time.sleep(max(0.0, a.pause - (time.time() - t0)))
    print("saved", out_path)


if __name__ == "__main__":
    main()
