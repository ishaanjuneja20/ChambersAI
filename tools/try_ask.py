#!/usr/bin/env python3
"""End-to-end test on the Mac (retrieve -> Gemini -> verified citations). From the data folder:
    pip3 install numpy sentence-transformers
    export GEMINI_API_KEY="..."        # your own Terminal only; never paste it into chat or commit it
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_ask.py criminal "what is the punishment for murder?"
    CHAMBERS_DATA_DIR=. PYTHONPATH=. python3 tools/try_ask.py family "तलाक के लिए क्या आधार हैं?"
"""
import json, sys
from pathlib import Path
from backend.rag.pipeline import answer

lawyers = json.loads((Path(__file__).resolve().parent.parent / "lawyers.json").read_text()) \
    if (Path(__file__).resolve().parent.parent / "lawyers.json").exists() else \
    [{"id": d, "domain": d, "name": "TBD", "personality": "TBD"} for d in
     ("criminal", "family", "consumer", "property", "labour", "constitutional")]
lw = next(l for l in lawyers if l["id"] == sys.argv[1])
out = answer(sys.argv[2], lw)
print(json.dumps(out, ensure_ascii=False, indent=2))
