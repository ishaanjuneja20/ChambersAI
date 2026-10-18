#!/usr/bin/env bash
# Start the ChambersAI backend on this laptop and open an HTTPS tunnel to it (Cloudflare quick tunnel).
#   bash deploy/start_local.sh          Ctrl-C stops both.
# Reads .chambers_env (GEMINI_API_KEY or GEMINI_API_KEYS, CHAMBERS_ALLOWED_ORIGINS, ...) from the project folder.
set -u
cd "$(dirname "$0")/.."
if [ -f .chambers_env ]; then set -a; . ./.chambers_env; set +a; fi
export CHAMBERS_DATA_DIR="${CHAMBERS_DATA_DIR:-$PWD}"
export CHAMBERS_TRUST_PROXY=1              # believe the visitor address Cloudflare passes on (rate limit is per visitor)
unset CHAMBERS_DEBUG CHAMBERS_TRACE        # debug output stays off when the server is public
PORT="${PORT:-8000}"
UV=""; CF=""
trap 'kill $UV $CF 2>/dev/null' EXIT INT TERM

if [ -z "${GEMINI_API_KEY:-}${GEMINI_API_KEYS:-}" ]; then echo "No Gemini key: put GEMINI_API_KEY=... in .chambers_env"; exit 1; fi
if [ -z "${CHAMBERS_ALLOWED_ORIGINS:-}" ]; then
  echo "Note: CHAMBERS_ALLOWED_ORIGINS is not set, so only a frontend on localhost can call this backend."
fi

python3 -m uvicorn backend.main:app --host 127.0.0.1 --port "$PORT" --workers 1 &
UV=$!
echo "Loading the embedding model and indexes (about a minute the first time)..."
for i in $(seq 1 240); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 $UV 2>/dev/null || { echo "The server stopped; see the error above."; exit 1; }
  sleep 1
done
echo "Backend is up on http://127.0.0.1:$PORT"

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel --url "http://127.0.0.1:$PORT" > .tunnel.log 2>&1 &
  CF=$!
  URL=""
  for i in $(seq 1 40); do
    URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' .tunnel.log 2>/dev/null | head -1)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -n "$URL" ]; then
    echo; echo "PUBLIC URL (changes every start): $URL"; echo "Check it with: bash deploy/smoke.sh $URL"
  else
    echo "The tunnel did not give a URL; see .tunnel.log"
  fi
else
  echo "cloudflared is not installed (brew install cloudflared), so this is reachable on this laptop only."
fi

command -v caffeinate >/dev/null 2>&1 && caffeinate -i -w $UV &     # keep the laptop awake while the server runs
wait $UV
