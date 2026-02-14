#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${1:-http://127.0.0.1:8011}"
EXPLICIT_KEY="${2:-}"
API_KEY_HEADER="${API_KEY_HEADER_NAME:-X-World-Gate}"
WORLD_GATE="${WORLD_GATE_KEY:-$EXPLICIT_KEY}"

if [ -z "$WORLD_GATE" ] && [ -t 0 ]; then
  printf "[diag] Enter API key (%s): " "$API_KEY_HEADER"
  stty -echo
  read -r WORLD_GATE
  stty echo
  echo
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[diag][PASS] $*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "[diag][WARN] $*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[diag][FAIL] $*"
}

curl_code() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local key_mode="${4:-none}"
  local out_file="${5:-$TMP_DIR/resp.txt}"

  local -a args
  args=(-sS -o "$out_file" -w "%{http_code}" -X "$method")

  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi

  if [ "$key_mode" = "with_key" ] && [ -n "$WORLD_GATE" ]; then
    args+=(-H "$API_KEY_HEADER: $WORLD_GATE")
  fi

  args+=("$BASE_URL$path")
  curl "${args[@]}"
}

echo "[diag] Base URL: $BASE_URL"
echo "[diag] API key header: $API_KEY_HEADER"
if [ -n "$WORLD_GATE" ]; then
  echo "[diag] API key provided: yes (${#WORLD_GATE} chars)"
else
  echo "[diag] API key provided: no"
fi

root_code="$(curl_code "GET" "/" "" "none" "$TMP_DIR/root.txt" || true)"
if [ "$root_code" = "200" ]; then
  pass "Health endpoint / is reachable (200)"
else
  fail "Health endpoint / returned $root_code"
fi

debug_code="$(curl_code "GET" "/debug/info" "" "none" "$TMP_DIR/debug.txt" || true)"
if [ "$debug_code" = "404" ]; then
  pass "Debug surface closed (/debug/info -> 404)"
elif [ "$debug_code" = "401" ]; then
  pass "Debug surface protected by auth (/debug/info -> 401)"
else
  warn "Debug endpoint visibility is not ideal (/debug/info -> $debug_code)"
fi

scenario_body='{"path":null}'
post_no_key_code="$(curl_code "POST" "/scenario/basic_auto" "" "none" "$TMP_DIR/post_no_key.txt" || true)"
if [ "$post_no_key_code" = "401" ]; then
  pass "Mutating endpoint is API-key protected (/scenario/basic_auto -> 401 without key)"
elif [ "$post_no_key_code" = "500" ]; then
  fail "Mutating endpoint expects key but WORLD_GATE_KEY appears missing in server config (500)"
else
  warn "Mutating endpoint is open or differently configured (/scenario/basic_auto -> $post_no_key_code without key)"
fi

if [ -n "$WORLD_GATE" ]; then
  post_with_key_code="$(curl_code "POST" "/scenario/basic_auto" "" "with_key" "$TMP_DIR/post_with_key.txt" || true)"
  if [ "$post_with_key_code" = "200" ]; then
    pass "Mutating endpoint works with API key (/scenario/basic_auto -> 200)"
  elif [ "$post_with_key_code" = "429" ]; then
    warn "Rate limit hit during scenario load with key (429). Increase window/max if needed."
  else
    fail "Mutating endpoint with key failed (/scenario/basic_auto -> $post_with_key_code)"
  fi
else
  warn "No API key supplied: cannot verify authorized mutating flow."
fi

if [ -n "$WORLD_GATE" ]; then
  persist_escape_code="$(curl_code "POST" "/persist/save" '{"path":"../escape.json","include_logs":false}' "with_key" "$TMP_DIR/persist_escape.txt" || true)"
  if [ "$persist_escape_code" = "400" ]; then
    pass "Persistence path hardening active (escape path rejected with 400)"
  elif [ "$persist_escape_code" = "401" ]; then
    warn "Persistence endpoint requires different API key header/value (401)"
  else
    fail "Persistence path hardening unexpected status ($persist_escape_code) for escape path"
  fi
else
  warn "No API key supplied: cannot verify persistence path hardening via protected endpoint."
fi

metrics_no_key_code="$(curl_code "GET" "/metrics" "" "none" "$TMP_DIR/metrics_no_key.txt" || true)"
if [ "$metrics_no_key_code" = "401" ]; then
  pass "Read endpoint guard enabled (/metrics requires API key)"
else
  warn "Read endpoint guard not enabled or not enforced (/metrics -> $metrics_no_key_code without key)"
fi

if [ -n "$WORLD_GATE" ]; then
  metrics_with_key_code="$(curl_code "GET" "/metrics" "" "with_key" "$TMP_DIR/metrics_with_key.txt" || true)"
  if [ "$metrics_with_key_code" = "200" ]; then
    pass "Read endpoint works with API key (/metrics -> 200)"
  elif [ "$metrics_with_key_code" = "429" ]; then
    warn "Read rate limit reached (/metrics -> 429). Tune limits for UI cadence."
  else
    fail "Read endpoint with key returned $metrics_with_key_code"
  fi
fi

if [ -n "$WORLD_GATE" ]; then
  rate_limit_hit=0
  for _ in $(seq 1 6); do
    code="$(curl_code "POST" "/auto/tick?limit_agents=50" "" "with_key" "$TMP_DIR/auto_tick.txt" || true)"
    if [ "$code" = "429" ]; then
      rate_limit_hit=1
      break
    fi
  done
  if [ "$rate_limit_hit" -eq 1 ]; then
    warn "429 observed during burst /auto/tick calls (rate limiting active; may be too strict for ACCELERATE mode)."
  else
    pass "Burst /auto/tick did not immediately hit 429 under current limits."
  fi
fi

echo
echo "[diag] Summary: PASS=$PASS_COUNT WARN=$WARN_COUNT FAIL=$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
