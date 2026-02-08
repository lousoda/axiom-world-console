
#!/usr/bin/env bash
# Minimal, deterministic smoke test for World Model Agent MVP.
# Goal: verify happy-path API + basic world/economy/explain wiring without flaky edge-cases.
# Usage: ./smoke_test.sh [BASE_URL]
# Example: ./smoke_test.sh http://127.0.0.1:8001

set -euo pipefail

BASE="${1:-http://127.0.0.1:8001}"
AUTH_HEADER_NAME="${SMOKE_API_KEY_HEADER:-X-API-Key}"
STRICT_TOKEN_GATE="$(printf '%s' "${STRICT_TOKEN_GATE:-false}" | tr '[:upper:]' '[:lower:]')"

# Optional: load env vars from .env (so you can set SMOKE_ENTRY_TX_HASH there)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -n "${SMOKE_API_KEY:-}" ]; then
  echo "Using auth header for POST requests: $AUTH_HEADER_NAME"
fi
if [ "$STRICT_TOKEN_GATE" = "true" ]; then
  echo "STRICT_TOKEN_GATE=true (token-gated join must be fully exercised)"
fi

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t wma_smoke)"
JOIN_RESP="$TMP_DIR/join_resp.json"
LOGS_RESP="$TMP_DIR/logs.json"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Smoke test base URL: $BASE"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

http_code() {
  curl -sS -o /dev/null -w "%{http_code}" "$@"
}

curl_post() {
  if [ -n "${SMOKE_API_KEY:-}" ]; then
    curl -sS -X POST -H "$AUTH_HEADER_NAME: $SMOKE_API_KEY" "$@"
  else
    curl -sS -X POST "$@"
  fi
}

post_code() {
  if [ -n "${SMOKE_API_KEY:-}" ]; then
    curl -sS -o /dev/null -w "%{http_code}" -X POST -H "$AUTH_HEADER_NAME: $SMOKE_API_KEY" "$@"
  else
    curl -sS -o /dev/null -w "%{http_code}" -X POST "$@"
  fi
}

extract_agent_id() {
  # Extract the joined agent id from JSON body without jq.
  # Supports either {"agent_id": 1} or {"agent": {"id": 1, ...}}
  local out
  out=$(sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1)
  if [ -n "$out" ]; then
    echo "$out"
    return 0
  fi
  sed -n 's/.*"agent"[[:space:]]*:[[:space:]]*{[^}]*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -n 1
}

step() {
  echo
  echo "== $1 =="
}

step "1. Health"
code=$(http_code "$BASE/")
[ "$code" = "200" ] && echo "GET / -> 200" || fail "GET / expected 200, got $code"

step "2. Debug info"
code=$(http_code "$BASE/debug/info")
if [ "$code" = "200" ]; then
  echo "GET /debug/info -> 200"
elif [ "$code" = "404" ]; then
  echo "GET /debug/info -> 404 (debug endpoints disabled; skipping)"
else
  fail "GET /debug/info expected 200 or 404, got $code"
fi

step "3. Reset"
resp=$(curl_post "$BASE/reset")
echo "$resp" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "POST /reset ok" || fail "POST /reset did not return ok:true"

step "4. Scenario/basic (optional)"
sc_code=$(post_code "$BASE/scenario/basic")
if [ "$sc_code" = "200" ]; then
  echo "POST /scenario/basic -> 200"
else
  echo "POST /scenario/basic -> $sc_code (skipping; endpoint may not exist)"
fi

step "5. World"
WORLD_JSON=$(curl -sS "$BASE/world")
echo "$WORLD_JSON" | grep -q '"tick"' && echo "GET /world contains tick" || fail "GET /world missing tick"

step "6. Persist status"
PERSIST_JSON=$(curl -sS "$BASE/persist/status")
echo "$PERSIST_JSON" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "GET /persist/status ok" || fail "GET /persist/status not ok:true"

step "7. Join (token-gated aware)"
JOINED=0
AGENT_ID=""

JOIN_STATUS=$(curl_post -o "$JOIN_RESP" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke_agent","deposit_mon":2}' \
  "$BASE/join")

if [ "$JOIN_STATUS" = "200" ]; then
  echo "POST /join ok (free join)"
  JOINED=1
  AGENT_ID="$(extract_agent_id "$JOIN_RESP")"
elif [ "$JOIN_STATUS" = "402" ]; then
  if [ -n "${SMOKE_ENTRY_TX_HASH:-}" ]; then
    JOIN_STATUS=$(curl_post -o "$JOIN_RESP" -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -d '{"name":"smoke_agent","deposit_mon":2,"entry_tx_hash":"'"$SMOKE_ENTRY_TX_HASH"'"}' \
      "$BASE/join")
    if [ "$JOIN_STATUS" = "200" ]; then
      echo "POST /join ok (token-gated via SMOKE_ENTRY_TX_HASH)"
      JOINED=1
      AGENT_ID="$(extract_agent_id "$JOIN_RESP")"
    else
      echo "POST /join token-gated attempt failed (status $JOIN_STATUS)"
      cat "$JOIN_RESP"
      fail "join failed"
    fi
  else
    echo "POST /join -> 402 Payment Required (set SMOKE_ENTRY_TX_HASH to fully exercise join)"
    if [ "$STRICT_TOKEN_GATE" = "true" ]; then
      fail "STRICT_TOKEN_GATE=true but SMOKE_ENTRY_TX_HASH is not set"
    fi
  fi
elif [ "$JOIN_STATUS" = "401" ]; then
  echo "POST /join -> 401 Unauthorized"
  echo "Hint: set SMOKE_API_KEY (and optionally SMOKE_API_KEY_HEADER, default X-API-Key)."
  cat "$JOIN_RESP"
  fail "join unauthorized"
elif [ "$JOIN_STATUS" = "500" ]; then
  echo "POST /join -> 500 Internal Server Error"
  echo "Hint: check MONAD_TREASURY_ADDRESS and MIN_ENTRY_FEE_WEI/MIN_ENTRY_FEE_MON, or set ALLOW_FREE_JOIN=true for local smoke."
  cat "$JOIN_RESP"
  fail "join server error"
else
  echo "POST /join unexpected status $JOIN_STATUS"
  cat "$JOIN_RESP"
  fail "join unexpected"
fi

if [ "$JOINED" != "1" ]; then
  echo "Skipping act/tick/logs/explain checks because agent did not join."
else
  if [ -z "$AGENT_ID" ]; then
    AGENT_ID="1"
    echo "WARN: could not parse agent id from join response; falling back to agent_id=1"
  else
    echo "Joined agent_id=$AGENT_ID"
  fi

  step "8. Act: move to workshop"
  ACT1=$(curl_post -H "Content-Type: application/json" \
    -d '{"agent_id":'"$AGENT_ID"',"type":"move","payload":{"to":"workshop"}}' \
    "$BASE/act")
  echo "$ACT1" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "POST /act move ok" || fail "POST /act move not ok:true"

  step "9. Tick: apply move"
  T1=$(curl_post "$BASE/tick?steps=1")
  echo "$T1" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "POST /tick ok" || fail "POST /tick not ok:true"

  step "10. Act: earn"
  ACT2=$(curl_post -H "Content-Type: application/json" \
    -d '{"agent_id":'"$AGENT_ID"',"type":"earn","payload":{"amount":1}}' \
    "$BASE/act")
  echo "$ACT2" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "POST /act earn ok" || fail "POST /act earn not ok:true"

  step "11. Tick: apply earn"
  T2=$(curl_post "$BASE/tick?steps=1")
  echo "$T2" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' && echo "POST /tick ok" || fail "POST /tick not ok:true"

  step "12. Logs"
  code=$(curl -sS -o "$LOGS_RESP" -w "%{http_code}" "$BASE/logs?limit=10")
  [ "$code" = "200" ] && echo "GET /logs -> 200" || (cat "$LOGS_RESP"; fail "GET /logs expected 200, got $code")

  step "13. Explain recent"
  EXPL=$(curl -sS "$BASE/explain/recent?limit=50")
  echo "$EXPL" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || (echo "$EXPL"; fail "GET /explain/recent not ok:true")
  echo "$EXPL" | grep -Eq 'auto_decision|earned|earn_denied_capacity|earn_denied_wrong_location|earn_denied' \
    && echo "explain contains decision/economy activity" \
    || (echo "$EXPL"; fail "explain missing decision/economy activity")
fi

step "14. Debug endpoints"
code=$(http_code "$BASE/debug/source")
if [ "$code" = "200" ]; then
  echo "GET /debug/source -> 200"
elif [ "$code" = "404" ]; then
  echo "GET /debug/source -> 404 (debug endpoints disabled; skipping)"
else
  fail "GET /debug/source expected 200 or 404, got $code"
fi

code=$(http_code "$BASE/debug/monad")
if [ "$code" = "200" ]; then
  echo "GET /debug/monad -> 200"
elif [ "$code" = "404" ]; then
  echo "GET /debug/monad -> 404 (debug endpoints disabled; skipping)"
else
  fail "GET /debug/monad expected 200 or 404, got $code"
fi

echo
echo "Smoke test done."
