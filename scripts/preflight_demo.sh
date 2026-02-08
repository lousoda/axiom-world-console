#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.demo.local}"
BASE_URL="${2:-${DEMO_BASE_URL:-http://127.0.0.1:8011}}"

log() {
  echo "[preflight] $*"
}

fail() {
  echo "[preflight] FAIL: $*" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "Env file not found: $ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

command -v curl >/dev/null 2>&1 || fail "curl is required"
[ -f "$ROOT_DIR/smoke_test.sh" ] || fail "smoke_test.sh is missing"

bash -n "$ROOT_DIR/smoke_test.sh"
# Lint this script too (cheap sanity)
bash -n "$0"

: "${ALLOW_FREE_JOIN:=true}"
: "${REQUIRE_API_KEY:=true}"
: "${DEBUG_ENDPOINTS_ENABLED:=false}"
: "${RATE_LIMIT_ENABLED:=true}"
: "${RATE_LIMIT_MAX_REQUESTS:=100}"
: "${RATE_LIMIT_WINDOW_SEC:=60}"
: "${MONAD_CHAIN_ID:=143}"

if [ "$REQUIRE_API_KEY" = "true" ] && [ -z "${WORLD_API_KEY:-}" ]; then
  fail "REQUIRE_API_KEY=true but WORLD_API_KEY is empty"
fi

if [ "$ALLOW_FREE_JOIN" != "true" ]; then
  [ -n "${MONAD_RPC_URL:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_RPC_URL"
  [ -n "${MONAD_TREASURY_ADDRESS:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_TREASURY_ADDRESS"
fi

if [ -n "${MONAD_RPC_URL:-}" ]; then
  rpc_code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 6 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"web3_clientVersion","params":[]}' \
    "$MONAD_RPC_URL" || true)
  [ "$rpc_code" = "200" ] || fail "MONAD_RPC_URL check failed (HTTP $rpc_code)"

  if [ "$ALLOW_FREE_JOIN" != "true" ]; then
    expected_chain_dec=$(python3 - <<'PY' 2>/dev/null || true
import os
raw = os.getenv("MONAD_CHAIN_ID", "143").strip()
try:
    value = int(raw, 0)
except Exception:
    print("")
else:
    print(value if value > 0 else "")
PY
)
    [ -n "$expected_chain_dec" ] || fail "MONAD_CHAIN_ID must be a positive integer (got '${MONAD_CHAIN_ID}')"

    chain_dec=$(curl -sS --max-time 6 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      "$MONAD_RPC_URL" | python3 -c 'import json,sys
try:
    result = json.load(sys.stdin).get("result", "")
    if isinstance(result, str):
        print(int(result, 16) if result.lower().startswith("0x") else int(result))
    elif isinstance(result, int):
        print(result)
    else:
        print("")
except Exception:
    print("")' 2>/dev/null || true)
    [ -n "$chain_dec" ] || fail "Failed to read eth_chainId from MONAD_RPC_URL"

    if [ "$chain_dec" != "$expected_chain_dec" ]; then
      fail "Wrong chain id from RPC (expected $expected_chain_dec, got $chain_dec). Check MONAD_RPC_URL / MONAD_CHAIN_ID."
    fi
    log "MONAD chainId OK ($chain_dec)"
  fi

  log "MONAD_RPC_URL reachable"
fi

health_code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)
[ "$health_code" = "200" ] || fail "Server health check failed at $BASE_URL/ (HTTP $health_code). Start server first."

if [ "$REQUIRE_API_KEY" = "true" ]; then
  SMOKE_API_KEY="${WORLD_API_KEY}" \
  SMOKE_API_KEY_HEADER="${API_KEY_HEADER_NAME:-X-API-Key}" \
  "$ROOT_DIR/smoke_test.sh" "$BASE_URL"
else
  "$ROOT_DIR/smoke_test.sh" "$BASE_URL"
fi

log "Preflight passed. Demo environment is ready."
