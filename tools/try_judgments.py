#!/usr/bin/env python3
"""Try judgment retrieval on the Mac. From ~/Desktop/RAG Datasets (repo copied/linked as ./backend):

    pip install numpy sentence-transformers
    python3 tools/build_judgment_offsets.py --root .            # once, about a minute
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_judgments.py "can police arrest without a warrant" criminal
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_judgments.py "Maneka Gandhi passport impounded" constitutional

Prints the top paragraphs with the card similarity (case level) and paragraph similarity. Nothing is sent anywhere.
"""
import sys
import time

from backend.rag.judgments import JUDGMENT_REFUSAL_THRESHOLD, retrieve_judgments

q, dom = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
t0 = time.time()
hits = retrieve_judgments(q, dom, k=5)
print(f"{time.time() - t0:.1f}s (first call includes loading the index and the model)")
best = hits[0]["similarity"] if hits else 0
print(f"best paragraph similarity {best:.3f}, provisional threshold {JUDGMENT_REFUSAL_THRESHOLD} -> "
      f"{'REFUSE' if best < JUDGMENT_REFUSAL_THRESHOLD else 'ANSWER'}")
for h in hits:
    print(f"\npara {h['similarity']:.3f}  case {h['card_similarity']:.3f}  (score {h['score']:.3f})\n  {h['chunk']['citation']}\n  {h['chunk']['text'][:300]}")
