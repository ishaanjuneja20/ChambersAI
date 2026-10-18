#!/usr/bin/env python3
"""Watch the streaming answer arrive and time it, without any server:
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_stream.py criminal "what is the punishment for murder?"
Prints each event with the seconds since the question was sent (the first sentence time is what a voice user waits for)."""
import json, sys, time
from pathlib import Path
from backend.rag.pipeline import answer_stream, warmup

lawyers = {d: {"id": d, "domain": d, "name": "TBD", "personality": "TBD"} for d in
           ("criminal", "family", "consumer", "property", "labour", "constitutional")}
lw = json.loads(Path("lawyers.json").read_text()) if Path("lawyers.json").exists() else []
lawyers.update({l["id"]: l for l in lw})
warmup()                                   # a running server does this at start-up
t = time.time()
for ev in answer_stream(sys.argv[2], lawyers[sys.argv[1]]):
    print(f"[{time.time() - t:5.1f}s] {ev['type']:9s}", ev.get("speak") or ev.get("answer") or ev.get("message") or ev.get("citations") or "")
    for c in ev.get("new_citations", []):
        print(f"           [{c['n']}] {c['text']}")
