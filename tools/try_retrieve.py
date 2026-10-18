#!/usr/bin/env python3
"""Try the real retriever on the Mac. From the data folder (with the repo copied/linked as ./backend):
    pip install numpy sentence-transformers
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_retrieve.py "punishment for murder" criminal
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_retrieve.py "तलाक के लिए क्या आधार हैं" family
"""
import sys
from backend.rag.retrieve import detect_lang, refusal_threshold, retrieve

q, dom = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
lang = detect_lang(q)
hits = retrieve(q, dom, k=5)
th = refusal_threshold(lang)
print(f"lang={lang} threshold={th} -> {'REFUSE' if hits[0]['similarity'] < th else 'ANSWER'}")
for h in hits:
    print(f"{h['similarity']:.3f} (score {h['score']:.3f})  {h['chunk']['citation']}  - {h['chunk']['meta'].get('title')}")
