#!/usr/bin/env python3
"""Times one short Gemini answer per model/thinking setting, to pick the fastest model for the answer step.
    export GEMINI_API_KEY=...; python3 tools/time_gemini.py
Sends a fixed legal-text prompt only (no client text)."""
import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend.rag import generate as G

SRC = "[hma-13] HMA s.13: Any marriage may be dissolved by a decree of divorce on the petition of either spouse on grounds of adultery, cruelty, desertion for two years, conversion, incurable unsoundness of mind, venereal disease, renunciation of the world, or not heard of as alive for seven years."
for model in ("gemini-flash-latest", "gemini-flash-lite-latest"):
    for think in (None, 0):
        gc = {"temperature": 0.2, "maxOutputTokens": 1500}
        if think is not None:
            gc["thinkingConfig"] = {"thinkingBudget": think}
        body = {"contents": [{"role": "user", "parts": [{"text": f"SOURCES\n{SRC}\n\nQUESTION\nGrounds for divorce? Answer in 5 sentences citing [hma-13]."}]}],
                "generationConfig": gc}
        t = time.time()
        try:
            out = G.call_gemini(body, model=model)
            print(f"{model:28s} thinking={think!s:5s} {time.time()-t:5.1f}s  {len(out)} chars")
        except G.GenerationError as e:
            print(f"{model:28s} thinking={think!s:5s} {time.time()-t:5.1f}s  ERROR {e}")
