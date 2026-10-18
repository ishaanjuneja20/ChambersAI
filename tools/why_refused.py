#!/usr/bin/env python3
"""Why was a real question refused? Prints, per question id, the refusal reason and the numbers behind it.

    source ./.chambers_env
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/why_refused.py f03 f05 f13 p05 p06 h01 h04

Reasons: "best similarity below threshold" (retrieval said nothing reliable), "model found no answer in the sources"
(the model replied NO_SOURCE), "model gave no valid citation". Shows the best statute and judgment similarities and
the rewrite. Uses the test questions only.
"""
import json, os, sys, time
os.environ["CHAMBERS_DEBUG"] = "1"
from pathlib import Path
from backend.rag.pipeline import answer

root = Path(os.environ.get("CHAMBERS_DATA_DIR", "."))
qs = {q["id"]: q for q in json.loads((root / "tests/eval/judgment_questions.json").read_text(encoding="utf-8"))}
lawyers = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}
for qid in sys.argv[1:]:
    q = qs[qid]
    lw = lawyers.get(q["lawyer"]) or {"id": "", "domain": "", "name": "TBD", "personality": "TBD"}
    out = answer(q["question"], lw)
    d = out.get("debug", {})
    print(f"\n[{qid}] {'REFUSED' if out['refused'] else 'answered'}  {q['question'][:90]}")
    print("  reason:", d.get("reason"), "| lang", d.get("lang"), "threshold", d.get("threshold"))
    print("  rewrite:", d.get("rewrite"))
    print("  statutes:", d.get("top"))
    print("  judgments:", [(c[:60], s) for c, s in d.get("judgments", [])])
    time.sleep(8)
