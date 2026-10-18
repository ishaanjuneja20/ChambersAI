#!/usr/bin/env bash
# Check a running backend:  bash deploy/smoke.sh https://xxxx.trycloudflare.com [https://your-frontend-origin]
URL="${1:-http://127.0.0.1:8000}"; ORIGIN="${2:-http://localhost:5173}"
ok() { echo "  ok   $1"; }; bad() { echo "  FAIL $1"; FAILED=1; }
FAILED=0
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
J='Content-Type: application/json'
[ "$(code "$URL/health")" = 200 ] && ok "/health" || bad "/health"
curl -s "$URL/lawyers" | grep -q '"id"' && ok "/lawyers lists the lawyers" || bad "/lawyers"
[ "$(code -X POST -H "$J" -d '{"lawyer":"nobody","question":"hi"}' "$URL/ask")" = 404 ] && ok "unknown lawyer -> 404" || bad "unknown lawyer should be 404"
LONG=$(python3 -c "print('x'*700)")
BODY="{\"lawyer\":\"criminal\",\"question\":\"$LONG\"}"       # built first: macOS bash 3.2 mishandles quotes nested in $( )
STATUS=$(code -X POST -H "$J" -d "$BODY" "$URL/ask")
[ "$STATUS" = 413 ] && ok "long question -> 413" || bad "long question should be 413 (got $STATUS)"
curl -s -D - -o /dev/null -H "Origin: $ORIGIN" "$URL/health" | grep -qi "access-control-allow-origin: $ORIGIN" && ok "CORS allows $ORIGIN" || bad "CORS does not allow $ORIGIN (set CHAMBERS_ALLOWED_ORIGINS)"
curl -s -D - -o /dev/null -H "Origin: https://evil.example" "$URL/health" | grep -qi "access-control-allow-origin" && bad "CORS allows a stranger" || ok "CORS refuses other origins"
echo "  asking one real question (takes a few seconds)..."
R=$(curl -s -X POST -H "$J" -d '{"lawyer":"criminal","question":"What is the punishment for murder?"}' "$URL/ask")
echo "$R" | grep -q '"refused": *false' && ok "/ask answered with citations" || bad "/ask did not answer: $(echo "$R" | cut -c1-200)"
echo "$R" | grep -q '"debug"' && bad "debug output is ON (unset CHAMBERS_DEBUG)" || ok "debug output is off"
[ $FAILED = 0 ] && echo "ALL GOOD" || { echo "SOME CHECKS FAILED"; exit 1; }
