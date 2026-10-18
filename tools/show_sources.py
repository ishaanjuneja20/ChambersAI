#!/usr/bin/env python3
"""Show exactly what the answer model saw for review questions, and what it said. Diagnostic only.

For each question id (from tests/eval/judgment_questions.json) this runs the real pipeline steps (rewrite, retrieve,
thresholds) and writes ONE text file per question to corpus/eval/show/<id>.txt with:
  - both rewrites, the top statute chunks with raw similarity (marked when dropped by the threshold),
  - every source sent to Gemini, with the same text the model got (cut at MAX_SOURCE_CHARS),
  - the model's raw reply and the final answer after citation checking.
Terminal output is only a short summary, so you can read the files here or send them to Claude.

    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/show_sources.py f03 f08 f07 h04 p08
    ... --text "your own question" --lawyer criminal        (any question, not from the file)
"""
import argparse, json, os, sys, time
from pathlib import Path
from backend.rag import judgments as J
from backend.rag.generate import MAX_SOURCE_CHARS, NO_SOURCE, generate
from backend.rag.pipeline import _prepare
from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve
from backend.rag.verify import verify_citations

ap = argparse.ArgumentParser()
ap.add_argument("ids", nargs="*")
ap.add_argument("--text")
ap.add_argument("--lawyer")
ap.add_argument("--out", default="corpus/eval/show")
a = ap.parse_args()

root = Path(os.environ.get("CHAMBERS_DATA_DIR", "."))
lawyers = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}
qs = {q["id"]: q for q in json.loads((root / "tests/eval/judgment_questions.json").read_text(encoding="utf-8"))}
todo = [(i, qs[i]["lawyer"], qs[i]["question"], qs[i]["lang"]) for i in a.ids]
if a.text:
    todo.append(("custom", a.lawyer or "criminal", a.text, detect_lang(a.text)))
out_dir = root / a.out
out_dir.mkdir(parents=True, exist_ok=True)

for qid, lw_id, q, lang in todo:
    lw = lawyers[lw_id]
    os.environ["CHAMBERS_DEBUG"] = "1"
    hits, info = _prepare(q, lw, lang, True)
    th = refusal_threshold(lang)
    L = [f"{qid} | lawyer={lw_id} lang={lang}", q, "", f"statute rewrite: {info['rewrite']}",
         f"statute threshold {th} | judgment threshold {J.JUDGMENT_REFUSAL_THRESHOLD}",
         "", "TOP STATUTE CHUNKS (raw; the whole statute list is dropped unless the first is >= threshold):"]
    for h in retrieve(q, lw["domain"], k=8, rewritten=info["rewrite"]):
        L.append(f"  {h['similarity']:.3f} {'KEEP' if h['similarity'] >= th else 'below'}  {h['chunk']['citation']}")
    L += ["", f"SOURCES SENT TO THE MODEL: {len(hits)}"]
    for h in hits:
        c = h["chunk"]
        L += ["", f"--- [{c['id']}] {c['citation']}  (kind={c.get('kind')}, {len(c['text'])} chars, model saw {min(len(c['text']), MAX_SOURCE_CHARS)})",
              c["text"][:MAX_SOURCE_CHARS]]
    raw = ""
    if hits:
        time.sleep(4)
        try:
            raw = generate(q, hits, lang, lw)
        except Exception as e:
            raw = f"[generation failed: {e}]"
    L += ["", "=" * 70, "RAW MODEL REPLY:", raw or "(no sources, nothing sent)"]
    if raw and NO_SOURCE not in raw and not raw.startswith("[generation failed"):
        text, cites, dropped = verify_citations(raw, hits, numbered=True)
        L += ["", "FINAL ANSWER:", text, "", "CITATIONS:"] + [f"  [{i + 1}] {c}" for i, c in enumerate(cites)]
    (out_dir / f"{qid}.txt").write_text("\n".join(L), encoding="utf-8")
    verdict = "no sources" if not hits else ("NO_SOURCE" if NO_SOURCE in raw else "answered")
    print(f"{qid}: {len(hits)} sources, {verdict} -> {a.out}/{qid}.txt", flush=True)
