#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-local}"
PORT="${2:-8011}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="${BASE_URL:-http://${HOST}:${PORT}}"

log() {
  echo "[demo_gate] $*"
}

fail() {
  echo "[demo_gate] FAIL: $*" >&2
  exit 1
}

resolve_env_file() {
  case "$PROFILE" in
    local) echo "$ROOT_DIR/.env.demo.local" ;;
    live) echo "$ROOT_DIR/.env.demo.live" ;;
    *)
      if [ -f "$PROFILE" ]; then
        echo "$PROFILE"
      else
        fail "Unknown profile '$PROFILE'. Use 'local', 'live', or pass a valid env file path."
      fi
      ;;
  esac
}

ENV_FILE="$(resolve_env_file)"
[ -f "$ENV_FILE" ] || fail "Env file not found: $ENV_FILE"

[ -n "${WORLD_GATE_KEY:-}" ] || fail "WORLD_GATE_KEY must be exported in shell"
: "${API_KEY_HEADER_NAME:=X-World-Gate}"

if [[ "$ENV_FILE" == *".env.demo.live"* ]]; then
  [ -n "${SMOKE_ENTRY_TX_HASH:-}" ] || fail "SMOKE_ENTRY_TX_HASH must be exported for live strict verification"
fi

mkdir -p "$ROOT_DIR/ARTIFACTS"
SERVER_LOG="$ROOT_DIR/ARTIFACTS/demo_gate_server_${PORT}.log"

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log "Starting server via run_demo.sh (workers=1 enforced)"
PORT="$PORT" WORLD_GATE_KEY="$WORLD_GATE_KEY" API_KEY_HEADER_NAME="$API_KEY_HEADER_NAME" bash "$ROOT_DIR/scripts/run_demo.sh" "$ENV_FILE" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" || true)
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 0.25
done
[ "${code:-000}" = "200" ] || fail "Server did not become healthy at $BASE_URL/. See $SERVER_LOG"

log "Running preflight"
WORLD_GATE_KEY="$WORLD_GATE_KEY" \
API_KEY_HEADER_NAME="$API_KEY_HEADER_NAME" \
SMOKE_ENTRY_TX_HASH="${SMOKE_ENTRY_TX_HASH:-}" \
bash "$ROOT_DIR/scripts/preflight_demo.sh" "$ENV_FILE" "$BASE_URL"

log "Gate passed"
