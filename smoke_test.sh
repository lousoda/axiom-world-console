#!/usr/bin/env bash
# Minimal smoke test (8–12 curl commands) for World Model Agent MVP.
# Usage: ./smoke_test.sh [BASE_URL]
# Example: ./smoke_test.sh http://127.0.0.1:8001

set -e
BASE="${1:-http://127.0.0.1:8001}"

# Optional: load env vars from .env (so you can set SMOKE_ENTRY_TX_HASH there)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

echo "Smoke test base URL: $BASE"

# 1) Health
curl -s -o /dev/null -w "%{http_code}" "$BASE/" | grep -q 200 && echo "1. GET / ok" || (echo "1. GET / fail"; exit 1)

# 2) Reset
curl -s -X POST "$BASE/reset" | grep -q '"ok":true' && echo "2. POST /reset ok" || (echo "2. POST /reset fail"; exit 1)

# 3) World state
curl -s "$BASE/world" | grep -q '"tick"' && echo "3. GET /world ok" || (echo "3. GET /world fail"; exit 1)

# 4) Persist status
curl -s "$BASE/persist/status" | grep -q '"ok":true' && echo "4. GET /persist/status ok" || (echo "4. GET /persist/status fail"; exit 1)

# 5) Join
# In token-gated mode (ALLOW_FREE_JOIN=false), you can optionally provide a real tx hash via:
#   SMOKE_ENTRY_TX_HASH=0x... ./smoke_test.sh   (or set SMOKE_ENTRY_TX_HASH in .env)
JOINED=0

JOIN_STATUS=$(curl -s -o /tmp/join_resp.json -w "%{http_code}" -X POST "$BASE/join" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke_agent","deposit_mon":2}')

if [ "$JOIN_STATUS" = "200" ]; then
  echo "5. POST /join ok (free join)"
  JOINED=1
elif [ "$JOIN_STATUS" = "402" ]; then
  if [ -n "$SMOKE_ENTRY_TX_HASH" ]; then
    JOIN_STATUS=$(curl -s -o /tmp/join_resp.json -w "%{http_code}" -X POST "$BASE/join" \
      -H "Content-Type: application/json" \
      -d '{"name":"smoke_agent","deposit_mon":2,"entry_tx_hash":"'"$SMOKE_ENTRY_TX_HASH"'"}')
    if [ "$JOIN_STATUS" = "200" ]; then
      echo "5. POST /join ok (token-gated via SMOKE_ENTRY_TX_HASH)"
      JOINED=1
    else
      echo "5. POST /join token-gated attempt failed (status $JOIN_STATUS)"
      cat /tmp/join_resp.json
      exit 1
    fi
  else
    echo "5. POST /join skipped (payment required, set SMOKE_ENTRY_TX_HASH to test join)"
  fi
else
  echo "5. POST /join unexpected status $JOIN_STATUS"
  cat /tmp/join_resp.json
  exit 1
fi

if [ "$JOINED" != "1" ]; then
  echo "6–9. Skipped action/tick/log/explain (no agent joined)"
else
# 6) Act
curl -s -X POST "$BASE/act" -H "Content-Type: application/json" -d '{"agent_id":1,"type":"move","payload":{"to":"workshop"}}' | grep -q '"ok":true' && echo "6. POST /act ok" || (echo "6. POST /act fail"; exit 1)

# 7) Tick
curl -s -X POST "$BASE/tick?steps=2" | grep -q '"ok":true' && echo "7. POST /tick ok" || (echo "7. POST /tick fail"; exit 1)

# 8) Logs
code=$(curl -s -o /tmp/smoke_logs.json -w "%{http_code}" "$BASE/logs?limit=5")
if [ "$code" = "200" ]; then
  echo "8. GET /logs ok"
else
  echo "8. GET /logs fail (http $code)"
  cat /tmp/smoke_logs.json
  exit 1
fi

# 9) Explain recent
curl -s "$BASE/explain/recent?limit=10" | grep -q '"ok":true' && echo "9. GET /explain/recent ok" || (echo "9. GET /explain/recent fail"; exit 1)
fi

# 10) Debug endpoints
curl -s "$BASE/debug/info" | grep -q '"tick"' && echo "10. GET /debug/info ok" || (echo "10. GET /debug/info fail"; exit 1)
curl -s "$BASE/debug/source" | grep -q '"ok":true' && echo "11. GET /debug/source ok" || (echo "11. GET /debug/source fail"; exit 1)
curl -s "$BASE/debug/monad" | grep -q '"ok":true' && echo "12. GET /debug/monad ok" || (echo "12. GET /debug/monad fail"; exit 1)

echo "Smoke test done."
