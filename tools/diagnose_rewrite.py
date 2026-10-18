"""Why does the rewrite sometimes come back unchanged? Calls the rewrite prompt once per model in the chain and prints
status, seconds, finishReason, thinking tokens and the raw text. Usage: python3 tools/diagnose_rewrite.py "question" ["question2" ...]
Needs GEMINI_API_KEY in the environment. Prints no key and no request text beyond the question you typed."""
import sys, time, json
from backend.rag.generate import API, _post, api_keys, model_chain, GenerationError
from backend.rag.rewrite import REWRITE_PROMPT

for q in sys.argv[1:]:
    print("\nQUESTION:", q)
    for m in model_chain():
        body = {"contents": [{"role": "user", "parts": [{"text": REWRITE_PROMPT + q}]}],
                "generationConfig": {"temperature": 0, "maxOutputTokens": 400}}
        t = time.time()
        try:
            d = _post(API.format(model=m), api_keys()[0], body)
            c = d["candidates"][0]
            text = "".join(p.get("text", "") for p in c.get("content", {}).get("parts", []))
            u = d.get("usageMetadata", {})
            print(f"  {m:26s} {time.time()-t:5.1f}s finish={c.get('finishReason')} thoughts={u.get('thoughtsTokenCount')} "
                  f"out={u.get('candidatesTokenCount')} text={text.strip()[:120]!r}")
        except GenerationError as e:
            print(f"  {m:26s} {time.time()-t:5.1f}s ERROR {e}")
        except Exception as e:
            print(f"  {m:26s} {time.time()-t:5.1f}s ERROR {type(e).__name__}")
        time.sleep(5)
