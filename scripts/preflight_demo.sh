#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_ENV_ARG="${1:-}"
ENV_FILE="${USER_ENV_ARG:-$ROOT_DIR/.env.demo.local}"
BASE_URL="${2:-${DEMO_BASE_URL:-http://127.0.0.1:8011}}"

log() {
  echo "[preflight] $*"
}

fail() {
  echo "[preflight] FAIL: $*" >&2
  exit 1
}

if [ ! -f "$ENV_FILE" ]; then
  # If caller didn't explicitly pass an env file, allow a safe fallback to repo-root .env
  if [ -z "$USER_ENV_ARG" ] && [ -f "$ROOT_DIR/.env" ]; then
    log "WARN: Env file not found: $ENV_FILE; falling back to $ROOT_DIR/.env"
    ENV_FILE="$ROOT_DIR/.env"
  else
    fail "Env file not found: $ENV_FILE"
  fi
fi

# Preserve explicit shell exports so env-file defaults do not override them.
EXPORTED_WORLD_GATE_KEY="${WORLD_GATE_KEY-}"
EXPORTED_API_KEY_HEADER_NAME="${API_KEY_HEADER_NAME-}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -n "$EXPORTED_WORLD_GATE_KEY" ]; then
  WORLD_GATE_KEY="$EXPORTED_WORLD_GATE_KEY"
  export WORLD_GATE_KEY
fi
if [ -n "$EXPORTED_API_KEY_HEADER_NAME" ]; then
  API_KEY_HEADER_NAME="$EXPORTED_API_KEY_HEADER_NAME"
  export API_KEY_HEADER_NAME
fi

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
: "${API_KEY_HEADER_NAME:=X-World-Gate}"

check_docker_profile_mismatch() {
  command -v docker >/dev/null 2>&1 || return 0
  docker inspect world_model_agent_api >/dev/null 2>&1 || return 0

  running_state=$(docker inspect -f '{{.State.Running}}' world_model_agent_api 2>/dev/null || true)
  [ "$running_state" = "true" ] || return 0

  container_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' world_model_agent_api 2>/dev/null || true)
  [ -n "$container_env" ] || return 0

  container_allow_free_join=$(printf '%s\n' "$container_env" | sed -n 's/^ALLOW_FREE_JOIN=//p' | tail -n1)
  container_require_api_key=$(printf '%s\n' "$container_env" | sed -n 's/^REQUIRE_API_KEY=//p' | tail -n1)

  if [ -n "$container_allow_free_join" ] && [ "$container_allow_free_join" != "$ALLOW_FREE_JOIN" ]; then
    fail "Profile mismatch: env file sets ALLOW_FREE_JOIN=$ALLOW_FREE_JOIN, but running Docker container has ALLOW_FREE_JOIN=$container_allow_free_join. Restart with matching DEMO_ENV_FILE."
  fi

  if [ -n "$container_require_api_key" ] && [ "$container_require_api_key" != "$REQUIRE_API_KEY" ]; then
    fail "Profile mismatch: env file sets REQUIRE_API_KEY=$REQUIRE_API_KEY, but running Docker container has REQUIRE_API_KEY=$container_require_api_key. Restart with matching DEMO_ENV_FILE."
  fi
}

if [ "$REQUIRE_API_KEY" = "true" ] && [ -z "${WORLD_GATE_KEY:-}" ]; then
  fail "REQUIRE_API_KEY=true but WORLD_GATE_KEY is empty"
fi

if [ "$ALLOW_FREE_JOIN" != "true" ]; then
  [ -n "${MONAD_RPC_URL:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_RPC_URL"
  [ -n "${MONAD_TREASURY_ADDRESS:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_TREASURY_ADDRESS"
fi

check_docker_profile_mismatch

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

SMOKE_STRICT_TOKEN_GATE="false"
if [ "$ALLOW_FREE_JOIN" != "true" ]; then
  [ -n "${SMOKE_ENTRY_TX_HASH:-}" ] || fail "ALLOW_FREE_JOIN=false requires SMOKE_ENTRY_TX_HASH for strict token-gated preflight"
  SMOKE_STRICT_TOKEN_GATE="true"
fi

if [ "$REQUIRE_API_KEY" = "true" ]; then
  SMOKE_API_KEY="${WORLD_GATE_KEY}" \
  SMOKE_API_KEY_HEADER="${API_KEY_HEADER_NAME:-X-World-Gate}" \
  STRICT_TOKEN_GATE="${SMOKE_STRICT_TOKEN_GATE}" \
  SMOKE_ENTRY_TX_HASH="${SMOKE_ENTRY_TX_HASH:-}" \
  "$ROOT_DIR/smoke_test.sh" "$BASE_URL"
else
  STRICT_TOKEN_GATE="${SMOKE_STRICT_TOKEN_GATE}" \
  SMOKE_ENTRY_TX_HASH="${SMOKE_ENTRY_TX_HASH:-}" \
  "$ROOT_DIR/smoke_test.sh" "$BASE_URL"
fi

log "Preflight passed. Demo environment is ready."
