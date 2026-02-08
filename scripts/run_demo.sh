#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_ENV_ARG="${1:-}"
ENV_FILE="${USER_ENV_ARG:-$ROOT_DIR/.env.demo.local}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8011}"

# Identify profile type for logs
PROFILE_NAME="local"
case "$ENV_FILE" in
  *live*) PROFILE_NAME="live" ;;
  *local*) PROFILE_NAME="local" ;;
  *) PROFILE_NAME="custom" ;;
esac

log() {
  echo "[run_demo] $*"
}

fail() {
  echo "[run_demo] FAIL: $*" >&2
  exit 1
}

if [ ! -f "$ENV_FILE" ]; then
  if [ -z "$USER_ENV_ARG" ] && [ -f "$ROOT_DIR/.env" ]; then
    log "WARN: Env file not found: $ENV_FILE; falling back to $ROOT_DIR/.env"
    ENV_FILE="$ROOT_DIR/.env"
  else
    fail "Env file not found: $ENV_FILE"
  fi
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${ALLOW_FREE_JOIN:=true}"
: "${REQUIRE_API_KEY:=true}"
: "${DEBUG_ENDPOINTS_ENABLED:=false}"
: "${RATE_LIMIT_ENABLED:=true}"
: "${RATE_LIMIT_MAX_REQUESTS:=100}"
: "${RATE_LIMIT_WINDOW_SEC:=60}"

if [ "$REQUIRE_API_KEY" = "true" ] && [ -z "${WORLD_API_KEY:-}" ]; then
  fail "REQUIRE_API_KEY=true but WORLD_API_KEY is empty"
fi

if [ "$ALLOW_FREE_JOIN" != "true" ]; then
  [ -n "${MONAD_RPC_URL:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_RPC_URL"
  [ -n "${MONAD_TREASURY_ADDRESS:-}" ] || fail "ALLOW_FREE_JOIN=false requires MONAD_TREASURY_ADDRESS"
fi

# Fail fast if port is already in use
if command -v lsof >/dev/null 2>&1; then
  if lsof -i :"$PORT" >/dev/null 2>&1; then
    fail "Port $PORT is already in use. Stop the running server or choose another PORT."
  fi
fi

cd "$ROOT_DIR"

log "Profile: $PROFILE_NAME"
log "Env file: $ENV_FILE"
log "Starting server on $HOST:$PORT (workers=1)"
log "Config: ALLOW_FREE_JOIN=$ALLOW_FREE_JOIN REQUIRE_API_KEY=$REQUIRE_API_KEY DEBUG_ENDPOINTS_ENABLED=$DEBUG_ENDPOINTS_ENABLED RATE_LIMIT_ENABLED=$RATE_LIMIT_ENABLED"

exec python3 -m uvicorn app:app --host "$HOST" --port "$PORT" --workers 1
