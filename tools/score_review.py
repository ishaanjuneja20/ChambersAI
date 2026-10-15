#!/usr/bin/env python3
"""Combine reviewer replies into reviewed test questions.

    python3 tools/score_review.py --root . corpus/review/replies/*.json

Each reply file is a JSON list (one object per question) in the format of docs/REVIEW_PROMPT.md:
    {"id": "f01", "candidates": {"A": "FULL", "B": "PARTIAL", "C": "NO", ...}, "answer": "FAITHFUL|PARTLY|UNFAITHFUL|n/a",
     "answer_issue": "...", "trap_verdict": "REFUSE_CORRECT|SHOULD_ANSWER|n/a", "missing_case": "...", "note": "..."}
Needs the key file written by tools/make_judgment_review.py. Writes tests/eval/judgment_questions.reviewed.json:
    acceptable_cases   case paths a MAJORITY of reviewers called FULL
    partial_cases      case paths a majority called FULL or PARTIAL (but not FULL)
    flags              questions where reviewers disagree, or most say the answer is unfaithful, or a trap should be answered
The draft gold case is kept in the list only if the reviewers back it. Reviewers are not lawyers: a human check of the flags is still needed.
"""
import argparse, json
from collections import Counter, defaultdict
from pathlib import Path


def load(files):
    out = []
    for f in files:
        txt = Path(f).read_text(encoding="utf-8").strip()
        txt = txt[txt.find("["): txt.rfind("]") + 1] if "[" in txt else txt   # tolerate text around the JSON
        out.append((Path(f).stem, json.loads(txt)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    root = Path(a.root)
    key = json.loads((root / "corpus/review/judgment_review_key.json").read_text(encoding="utf-8"))
    qs = json.loads((root / "tests/eval/judgment_questions.json").read_text(encoding="utf-8"))
    reviews = defaultdict(list)                      # id -> [(reviewer, item)]
    for name, items in load(a.files):
        for it in items:
            reviews[it["id"]].append((name, it))
    n_rev = len({n for rs in reviews.values() for n, _ in rs})
    need = n_rev // 2 + 1
    out, flags = [], []
    for q in qs:
        rs = reviews.get(q["id"], [])
        row = dict(q)
        if q["type"] == "trap":
            v = Counter(it.get("trap_verdict", "n/a") for _, it in rs)
            row["trap_verdicts"] = dict(v)
            if v.get("SHOULD_ANSWER", 0) >= 1:
                flags.append((q["id"], "a reviewer thinks this trap should be answered", dict(v)))
        else:
            votes = defaultdict(Counter)
            for _, it in rs:
                for L, verdict in (it.get("candidates") or {}).items():
                    if L in key.get(q["id"], {}):
                        votes[key[q["id"]][L]][verdict.upper()] += 1
            full = [p for p, c in votes.items() if c["FULL"] >= need]
            part = [p for p, c in votes.items() if c["FULL"] < need and c["FULL"] + c["PARTIAL"] >= need]
            row["acceptable_cases"], row["partial_cases"] = full, part
            gold = q["gold_cases"][0] if q["gold_cases"] else None
            if gold and gold not in full:
                flags.append((q["id"], "reviewers do not back the draft gold case", dict(votes.get(gold, {}))))
            split = [p for p, c in votes.items() if c["FULL"] and c["NO"]]
            if split:
                flags.append((q["id"], "reviewers disagree (FULL vs NO) on", [p for p in split]))
            if not full:
                flags.append((q["id"], "no candidate accepted as a full answer", {}))
            ans = Counter(it.get("answer", "n/a") for _, it in rs)
            row["answer_verdicts"] = dict(ans)
            if ans.get("UNFAITHFUL", 0) + ans.get("PARTLY", 0) >= need:
                flags.append((q["id"], "the app's answer is judged partly/un-faithful", dict(ans)))
            row["missing_case_suggestions"] = [it["missing_case"] for _, it in rs if it.get("missing_case")]
        out.append(row)
    (root / "tests/eval/judgment_questions.reviewed.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{n_rev} reviewers, majority = {need}; wrote tests/eval/judgment_questions.reviewed.json")
    print(f"{len(flags)} flags for a human check:")
    for qid, why, detail in flags:
        print(f"  {qid}: {why} {detail}")


if __name__ == "__main__":
    main()
