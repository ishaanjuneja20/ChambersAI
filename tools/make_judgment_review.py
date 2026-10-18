#!/usr/bin/env python3
"""Build the review pack for the judgment test questions (to be judged by reviewers, human or AI).

    source ./.chambers_env      # Gemini key (rewrite + answer); test questions only, nothing else is sent
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/make_judgment_review.py --root . [--no-answers] [--per-part 10]

For every question in tests/eval/judgment_questions.json it finds up to 8 candidate cases with the same retrieval the
app uses (judgment rewrite included), adds the draft gold case if it was not among them, and (unless --no-answers)
asks the app for its real answer. Reviewers then judge, from the SHOWN TEXT ONLY, which candidates answer the question
and whether the app's answer is faithful. Output (the model never sees which candidate is the draft gold):
    corpus/review/judgment_review_part1.md ...   what reviewers read (about 10 questions each)
    corpus/review/judgment_review_key.json       question id -> candidate letter -> case path (for scoring)
Reviewer replies are scored by tools/score_review.py.
"""
from __future__ import annotations
import argparse, json, os, random, re, sys, time
from pathlib import Path

from backend.rag import judgments as J
from backend.rag import retrieve as R

N_CAND = 8
EXCERPT = 600
LETTERS = "ABCDEFGHIJ"


def excerpt(text: str) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t[:EXCERPT] + (" ..." if len(t) > EXCERPT else "")


def candidates(question, lawyer, jr, index, embed):
    hits = J.search_judgments(question, lawyer, 40, index, embed, rewritten=jr)
    seen, out = set(), []
    for h in hits:
        m = h["chunk"]["meta"]
        if m["source_path"] in seen:
            continue
        seen.add(m["source_path"])
        out.append({"path": m["source_path"], "name": m["case_name"], "cite": m["case_citation"], "year": m["year"],
                    "para": m["para"], "text": h["chunk"]["text"], "sim": round(h["similarity_query"], 3)})
        if len(out) == N_CAND:
            break
    return out


def first_paragraph(index, path):
    year, s, e = index.ranges[path]
    return index.store.record(year, s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--no-answers", action="store_true")
    ap.add_argument("--no-rewrite", action="store_true")
    ap.add_argument("--per-part", type=int, default=10)
    ap.add_argument("--pause", type=float, default=8, help="seconds between Gemini-using questions (free tier)")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    qs = json.loads((root / "tests/eval/judgment_questions.json").read_text(encoding="utf-8"))
    lawyers = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}
    index = J.load_judgment_index(root)
    embed = R.get_embedder()
    by_path = {c["path"]: c for c in index.cases}
    rng = random.Random(a.seed)
    answer = None
    if not a.no_answers:
        from backend.rag.pipeline import answer as answer_fn
        answer = answer_fn
    if not a.no_rewrite:
        from backend.rag.rewrite import rewrite_query
    key, blocks = {}, []
    for n, q in enumerate(qs):
        lw = lawyers.get(q["lawyer"]) or {"id": "", "domain": "", "name": "TBD", "personality": "TBD"}
        jr = None if a.no_rewrite else rewrite_query(q["question"], target="judgments")
        cands = candidates(q["question"], lw["domain"], jr, index, embed)
        gold_added = False
        if q["type"] != "trap":
            for g in q["gold_cases"]:
                if g not in {c["path"] for c in cands} and g in index.ranges:
                    rec = first_paragraph(index, g)
                    c = by_path[g]
                    cands.append({"path": g, "name": c["title"], "cite": c["citation"], "year": c["year"],
                                  "para": rec.get("para"), "text": rec["text"], "sim": None})
                    gold_added = True
        rng.shuffle(cands)                                   # position must not reveal the draft gold
        key[q["id"]] = {L: c["path"] for L, c in zip(LETTERS, cands)}
        out = None
        if answer:
            time.sleep(a.pause)
            try:
                out = answer(q["question"], lw)
            except Exception as e:
                out = {"answer": f"ERROR {type(e).__name__}", "citations": [], "refused": None}
        lines = [f"## Question {q['id']}  ({q['lang']}, asked to the {q['lawyer'] or 'general'} lawyer)",
                 f"**Question:** {q['question']}", ""]
        if q["type"] == "trap":
            lines.append("_Draft expectation: the app should REFUSE this question (nothing in the sources answers it)._")
        lines.append("**Candidate cases (Supreme Court of India). Judge each from the excerpt shown:**")
        for L, c in zip(LETTERS, cands):
            lines.append(f"- **{L}.** {c['name']} - {c['cite'] or 'no citation'} ({c['year']}), para {c['para']}\n"
                         f"  > {excerpt(c['text'])}")
        if out is not None:
            lines.append("")
            if out["refused"]:
                lines.append("**The app's response:** REFUSED (\"I don't have a reliable source for this.\")")
            else:
                lines.append(f"**The app's answer:** {out['answer']}")
                lines.append("**Sources the answer cites:** " + "; ".join(f"[{i + 1}] {c}" for i, c in enumerate(out["citations"])))
        lines.append("\n---\n")
        blocks.append("\n".join(lines))
        print(f"{q['id']} done ({len(cands)} candidates{', gold added' if gold_added else ''})", flush=True)
    outdir = root / "corpus" / "review"
    outdir.mkdir(parents=True, exist_ok=True)
    parts = [blocks[i:i + a.per_part] for i in range(0, len(blocks), a.per_part)]
    for i, p in enumerate(parts, 1):
        (outdir / f"judgment_review_part{i}.md").write_text("\n".join(p), encoding="utf-8")
    (outdir / "judgment_review_key.json").write_text(json.dumps(key, indent=1), encoding="utf-8")
    print(f"wrote {len(parts)} parts and the key to {outdir}")


if __name__ == "__main__":
    main()
