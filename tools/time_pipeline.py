#!/usr/bin/env python3
"""Per-question latency with the models already loaded (what a running server sees).
    CHAMBERS_DEBUG=1 CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/time_pipeline.py
Prints the warm-up time once, then rewrite / retrieve / generate seconds for each question."""
import json, os, time
os.environ["CHAMBERS_DEBUG"] = "1"
from pathlib import Path
from backend.rag.pipeline import answer, warmup

lawyers = {d: {"id": d, "domain": d, "name": "TBD", "personality": "TBD"} for d in
           ("criminal", "family", "consumer", "property", "labour", "constitutional")}
t = time.time()
warmup()
print(f"warm-up (model + indexes): {time.time() - t:.1f}s\n")
for lw, q in [("criminal", "what is the rarest of rare doctrine for the death penalty?"),
              ("family", "तलाक के लिए क्या आधार हैं?"),
              ("criminal", "what is the punishment for murder?"),
              ("criminal", "best recipe for chicken biryani")]:
    t = time.time()
    out = answer(q, lawyers[lw])
    print(f"{lw:9s} total {time.time() - t:5.1f}s  refused={out['refused']}  {out.get('debug', {}).get('seconds')}")
