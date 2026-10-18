#!/usr/bin/env python3
"""Test every key in GEMINI_API_KEYS (or GEMINI_API_KEY) with one tiny request. Prints the key's position and the HTTP
status only, never the key.   source .chambers_env; PYTHONPATH=. python3 tools/check_keys.py"""
import json, urllib.error, urllib.request
from backend.rag.generate import DEFAULT_MODEL, api_keys

keys = api_keys()
print(f"{len(keys)} key(s) in the pool, testing model {DEFAULT_MODEL}")
body = json.dumps({"contents": [{"role": "user", "parts": [{"text": "Reply with the word ok."}]}],
                   "generationConfig": {"maxOutputTokens": 20}}).encode()
for i, key in enumerate(keys, 1):
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{DEFAULT_MODEL}:generateContent",
        data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  key {i}: works (HTTP {r.status})")
    except urllib.error.HTTPError as e:
        msg = {400: "rejected: bad request or invalid key", 401: "rejected: not authorised", 403: "rejected: key not allowed",
               429: "valid, but over its free quota right now", 503: "model busy, try again"}.get(e.code, "error")
        print(f"  key {i}: HTTP {e.code} {msg}")
    except Exception as e:
        print(f"  key {i}: could not connect ({type(e).__name__})")
