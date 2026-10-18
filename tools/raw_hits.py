#!/usr/bin/env python3
"""Look inside one question: both rewrites, the top 8 statute chunks and top 6 judgment cases with RAW similarities
(no threshold applied), and the model's raw reply to the sources the pipeline would send. Diagnostic only.

    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/raw_hits.py criminal "Can the police arrest a husband automatically in a dowry harassment case?"
"""
import json, os, sys
from pathlib import Path
from backend.rag.pipeline import _judgment_hits
from backend.rag.rewrite import rewrite_query
from backend.rag.retrieve import retrieve, detect_lang, refusal_threshold
from backend.rag import judgments as J
from backend.rag.generate import generate

root = Path(os.environ.get("CHAMBERS_DATA_DIR", "."))
lawyers = {l["id"]: l for l in json.loads((root / "lawyers.json").read_text(encoding="utf-8"))}
lw, q = lawyers[sys.argv[1]], sys.argv[2]
lang = detect_lang(q)
rs, rj = rewrite_query(q), rewrite_query(q, target="judgments")
print("lang", lang, "statute threshold", refusal_threshold(lang), "| judgment threshold", J.JUDGMENT_REFUSAL_THRESHOLD)
print("statute rewrite :", rs)
print("judgment rewrite:", rj)
print("\nTOP STATUTE CHUNKS (raw):")
for h in retrieve(q, lw["domain"], k=8, rewritten=rs):
    print(f"  {h['similarity']:.3f}  {h['chunk']['citation']}")
print("\nTOP JUDGMENT PARAGRAPHS (raw, before threshold):")
for h in J.retrieve_judgments(q, lw["domain"], k=6, rewritten=rj):
    print(f"  {h['similarity_query']:.3f}  {h['chunk']['citation'][:90]}")
if "--answer" in sys.argv:
    hits = [h for h in retrieve(q, lw["domain"], k=5, rewritten=rs) if h["similarity"] >= refusal_threshold(lang)] + _judgment_hits(q, lw["domain"], rj)
    print("\nRAW MODEL REPLY to", len(hits), "sources:\n", generate(q, hits, lang, lw))
