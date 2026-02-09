#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8011}"

ARG1="${1:-}"
ARG2="${2:-}"

# Support two calling styles:
#  1) bash scripts/run_demo.sh local 8011
#  2) bash scripts/run_demo.sh .env.demo.local 8011
if [ "$ARG1" = "local" ] || [ "$ARG1" = "live" ]; then
  PROFILE_NAME="$ARG1"
  ENV_FILE="$ROOT_DIR/.env.demo.${ARG1}"
  USER_ENV_ARG="$ENV_FILE"
  if [ -n "$ARG2" ] && [ "$ARG2" -eq "$ARG2" ] 2>/dev/null; then
    PORT="$ARG2"
  fi
else
  USER_ENV_ARG="$ARG1"
  ENV_FILE="${USER_ENV_ARG:-$ROOT_DIR/.env.demo.local}"
  # Optional 2nd arg can be a port when first arg is an env file path
  if [ -n "$ARG2" ] && [ "$ARG2" -eq "$ARG2" ] 2>/dev/null; then
    PORT="$ARG2"
  fi

  # Identify profile type for logs
  PROFILE_NAME="local"
  case "$ENV_FILE" in
    *live*) PROFILE_NAME="live" ;;
    *local*) PROFILE_NAME="local" ;;
    *) PROFILE_NAME="custom" ;;
  esac
fi

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

# Preserve explicit shell exports so env-file defaults do not override them.
EXPORTED_WORLD_GATE_KEY="${WORLD_GATE_KEY-}"
EXPORTED_API_KEY_HEADER_NAME="${API_KEY_HEADER_NAME-}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# Re-apply explicit exports (shell wins over env file)
if [ -n "$EXPORTED_WORLD_GATE_KEY" ]; then
  WORLD_GATE_KEY="$EXPORTED_WORLD_GATE_KEY"
  export WORLD_GATE_KEY
fi
if [ -n "$EXPORTED_API_KEY_HEADER_NAME" ]; then
  API_KEY_HEADER_NAME="$EXPORTED_API_KEY_HEADER_NAME"
  export API_KEY_HEADER_NAME
fi

: "${ALLOW_FREE_JOIN:=true}"
: "${REQUIRE_API_KEY:=true}"
: "${DEBUG_ENDPOINTS_ENABLED:=false}"
: "${RATE_LIMIT_ENABLED:=true}"
: "${RATE_LIMIT_MAX_REQUESTS:=100}"
: "${RATE_LIMIT_WINDOW_SEC:=60}"
: "${API_KEY_HEADER_NAME:=X-World-Gate}"

if [ "$REQUIRE_API_KEY" = "true" ] && [ -z "${WORLD_GATE_KEY:-}" ]; then
  fail "REQUIRE_API_KEY=true but WORLD_GATE_KEY is empty"
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

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
  else
    PYTHON_BIN="python3"
  fi
fi
log "Python: $PYTHON_BIN"

exec "$PYTHON_BIN" -m uvicorn app:app --host "$HOST" --port "$PORT" --workers 1
