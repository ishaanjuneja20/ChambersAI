#!/usr/bin/env python3
"""Run the consumer, property, labour and constitutional lawyers end to end (retrieve -> Gemini -> verified citations).

    export GEMINI_API_KEY="..."      # or GEMINI_API_KEYS; your own Terminal only
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_lawyers.py [--lawyers consumer,labour] [--per 2]

For each lawyer: --per answerable questions in each language from tests/eval/questions.json, every trap question there,
plus EXTRA (a legal question outside the lawyer's domain, and a plainly non-legal one). The domain boost is soft, so
the out-of-domain legal question may legitimately be answered from another domain's law; the non-legal one must be refused.
Prints one block per question and a summary; full output goes to corpus/eval/lawyer_run.json (made-up test questions only).
"""
import argparse, json, os, sys, time
from pathlib import Path
os.environ.setdefault("CHAMBERS_DEBUG", "1")
from backend.rag.pipeline import answer, warmup

ROOT = Path(__file__).resolve().parent.parent
EXTRA = {
    "consumer": [("What is the punishment for murder?", "out_of_domain"), ("Best way to cook paneer butter masala?", "non_legal")],
    "property": [("Can my employer fire me without notice?", "out_of_domain"), ("Who will win the next cricket world cup?", "non_legal")],
    "labour":   [("My neighbour built a wall on my plot. What can I do?", "out_of_domain"), ("How do I lose weight fast?", "non_legal")],
    "constitutional": [("My landlord is not returning my deposit.", "out_of_domain"), ("What is the capital of France?", "non_legal")],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lawyers", default="consumer,property,labour,constitutional")
    ap.add_argument("--per", type=int, default=2)
    ap.add_argument("--root", default=".")
    ap.add_argument("--pause", type=float, default=13, help="seconds between questions (free tier: ~15 requests/min, 3 calls per question)")
    ap.add_argument("--only-errors", action="store_true", help="re-ask only the questions that errored in the last run")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    lawyers = {l["id"]: l for l in json.loads((ROOT / "lawyers.json").read_text())}
    qs = json.loads((root / "tests/eval/questions.json").read_text(encoding="utf-8"))
    t = time.time(); warmup(); print(f"warm-up {time.time()-t:.1f}s")
    results = []
    prev = root / "corpus/eval/lawyer_run.json"
    redo = {(r["lawyer"], r["question"]) for r in json.loads(prev.read_text(encoding="utf-8")) if r["refused"] is None} \
        if a.only_errors and prev.exists() else None
    kept = [r for r in json.loads(prev.read_text(encoding="utf-8")) if r["refused"] is not None] if redo is not None else []
    for lid in a.lawyers.split(","):
        items = []
        for lang in ("en", "hi"):
            items += [(q["question"], f"answerable:{lang}:{q['id']}", q["gold"]) for q in qs
                      if q["lawyer"] == lid and q["lang"] == lang and q["type"] == "answerable"][: a.per]
        items += [(q["question"], f"trap:{q['lang']}:{q['id']}", []) for q in qs if q["lawyer"] == lid and q["type"] == "trap"]
        items += [(q, kind, []) for q, kind in EXTRA[lid]]
        for question, kind, gold in items:
            if redo is not None and (lid, question) not in redo:
                continue
            if results:
                time.sleep(a.pause)
            t0 = time.time()
            try:
                out = answer(question, lawyers[lid])
            except Exception as e:                         # keep going; report the error type only
                out = {"answer": f"ERROR {type(e).__name__}: {e}", "citations": [], "refused": None}
                if getattr(e, "code", None) in (400, 401, 403) and "key" in str(e).lower():
                    sys.exit(f"Stopped: {e}. Check GEMINI_API_KEY (use the real key, not a placeholder).")
            sec = time.time() - t0
            results.append({"lawyer": lid, "kind": kind, "question": question, "gold": gold, "seconds": round(sec, 1), **out})
            flag = "REFUSED" if out["refused"] else ("ERROR" if out["refused"] is None else "answered")
            print(f"\n[{lid}] {kind} ({sec:.1f}s) {flag}\nQ: {question}\n" +
                  (f"A: {out['answer'][:300]}\nCites: {out['citations']}\n" if flag != "REFUSED" else ""), flush=True)
    results = kept + results
    outp = root / "corpus/eval/lawyer_run.json"
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n=== summary (kind -> refused/answered) ===")
    for r in results:
        k = r["kind"].split(":")[0]
        state = "ERROR" if r["refused"] is None else ("refused" if r["refused"] else "answered")
        ok = state != "ERROR" and ((state == "refused") if k in ("trap", "non_legal") else (state == "answered"))
        print(f"{'ok   ' if ok else 'CHECK'} {r['lawyer']:15s} {r['kind']:22s} {state}")
    print("\nwritten", outp)


if __name__ == "__main__":
    main()
