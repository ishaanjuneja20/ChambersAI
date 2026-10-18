# Hosting on a laptop (hackathon demo)

The backend runs on a laptop; a Cloudflare tunnel gives it a public HTTPS address; the frontend (a static site)
calls that address. Visitors install nothing. Only the host laptop needs the corpus, the embeddings and the judgment index.

## One-time setup (on the host laptop)
1. `pip3 install -r requirements.txt` (FastAPI, uvicorn, sentence-transformers, ...).
2. `brew install cloudflared` (without it the API is reachable on this laptop only).
3. Put the settings in `.chambers_env` in the project folder (git ignores it; never commit it):
   ```
   GEMINI_API_KEY=...                      # or GEMINI_API_KEYS=key1,key2,key3 to share the quota
   CHAMBERS_ALLOWED_ORIGINS=https://your-frontend.example   # comma separated; no trailing slash; never *
   ```
4. Plug the laptop in, use a stable network, and turn off its sleep (the script runs `caffeinate`).

## Every demo
```
bash deploy/start_local.sh          # prints PUBLIC URL after the models load (about a minute)
bash deploy/smoke.sh <PUBLIC URL> <frontend origin>     # all lines should say ok
```
The quick-tunnel URL is new each time. Give it to the frontend through a config value, not a hard-coded string
(a named tunnel with your own domain keeps one address: `cloudflared tunnel login`, then a named tunnel; not needed for a demo).
Ctrl-C stops the server and the tunnel.

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `CHAMBERS_ALLOWED_ORIGINS` | localhost:3000, localhost:5173 | frontends allowed to call the API (CORS) |
| `CHAMBERS_RATE_LIMIT` | 10 | questions a minute per visitor; 0 = off |
| `CHAMBERS_RATE_LIMIT_ALL` | 0 (off) | questions a minute from everyone together; set it near your Gemini quota, e.g. 8 per key |
| `CHAMBERS_MAX_QUESTION` | 600 | longest question in characters |
| `CHAMBERS_TRUST_PROXY` | 1 in the script | believe CF-Connecting-IP for the rate limit; keep 0 if the API is exposed without the tunnel |
| `CHAMBERS_WARMUP` | 1 | load the models at start so the first question is fast |
| `GEMINI_API_KEYS` | - | several keys, comma separated; each has its own free quota |

## Capacity and cost, honestly
- A question makes 3 Gemini calls (4 for Hinglish). A free key allows 15 calls a minute per model, with two models as fallback,
  so roughly 5-10 questions a minute per key. For a crowd, use several keys and set `CHAMBERS_RATE_LIMIT_ALL`.
- Free-tier keys may use prompts for training: use made-up questions in the demo. For real users use a billing-enabled key with a spending cap.
- One uvicorn worker only: the models and indexes live in memory, a second worker would load them again.
- A second laptop can run the same script; the frontend tries URL 1, then URL 2 if the first errors or is silent for ~15 s.

## Privacy (CLAUDE.md rule 6)
- Question text is never written to logs (uvicorn logs the path, status and tunnel address only). `CHAMBERS_DEBUG` and `CHAMBERS_TRACE` are unset by the script.
- The API stores nothing: no questions, no answers. Accounts or saved client data would need encryption at rest first.

## If it breaks
- `Backend ... server stopped`: the error above it, usually a missing package or key.
- 403/CORS error in the browser: the frontend's exact origin is missing from `CHAMBERS_ALLOWED_ORIGINS` (restart after changing).
- 429: the visitor asked too often; 503: Gemini is out of quota or down (add keys or wait a minute).
- Tunnel URL died: restart the script and give the frontend the new URL.
