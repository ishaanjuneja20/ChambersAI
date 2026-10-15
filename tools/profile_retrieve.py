#!/usr/bin/env python3
"""Where do the retrieve seconds go? Times each step once cold and then 3x warm.
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/profile_retrieve.py
Questions only go to the local model; nothing is sent anywhere."""
import time
from backend.rag import retrieve as R
from backend.rag import judgments as J

def t(label, fn, n=3):
    s = time.time(); fn(); cold = time.time() - s
    w = []
    for _ in range(n):
        s = time.time(); fn(); w.append(time.time() - s)
    print(f"{label:34s} first {cold:6.2f}s   warm {min(w):6.2f}s")

q, rw = "तलाक के लिए क्या आधार हैं?", "grounds for divorce dissolution of marriage Hindu marriage act"
s = time.time(); emb = R.get_embedder(); print(f"{'load bge-m3':34s} {time.time()-s:6.2f}s")
s = time.time(); R.set_backend(R.load_index(), emb); print(f"{'load statute index':34s} {time.time()-s:6.2f}s")
s = time.time(); idx = J.load_judgment_index(); J.set_judgment_index(idx); print(f"{'load judgment index':34s} {time.time()-s:6.2f}s")
n = [0]
def fresh():                       # new text each call so the embedding cache can't hide the model cost
    n[0] += 1
    emb([f"{q} {n[0]}", f"{rw} {n[0]}"])
t("embed 2 texts (model only)", fresh)
t("statute search (q + rewrite)", lambda: R.retrieve(q, "family", rewritten=rw))
t("judgment search (q + rewrite)", lambda: J.retrieve_judgments(q, "family", k=3, rewritten=rw))
