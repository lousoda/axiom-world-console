#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-}"
PORT="${2:-8001}"

log() {
  echo "[docker_gate] $*"
}

fail() {
  echo "[docker_gate] FAIL: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  bash scripts/docker_gate.sh local [PORT]
  bash scripts/docker_gate.sh live [PORT]

Required env:
  WORLD_GATE_KEY

Additional required env for live:
  SMOKE_ENTRY_TX_HASH
EOF
}

[ "$PROFILE" = "local" ] || [ "$PROFILE" = "live" ] || {
  usage
  fail "First argument must be 'local' or 'live'"
}

if [ -n "$PORT" ] && ! [ "$PORT" -eq "$PORT" ] 2>/dev/null; then
  fail "PORT must be numeric (got '$PORT')"
fi

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"
[ -f "$ROOT_DIR/docker-compose.yml" ] || fail "docker-compose.yml not found in $ROOT_DIR"

[ -n "${WORLD_GATE_KEY:-}" ] || fail "WORLD_GATE_KEY is required"
if [ "$PROFILE" = "live" ] && [ -z "${SMOKE_ENTRY_TX_HASH:-}" ]; then
  fail "live profile requires SMOKE_ENTRY_TX_HASH"
fi

ENV_FILE="$ROOT_DIR/.env.demo.${PROFILE}"
[ -f "$ENV_FILE" ] || fail "Env file not found: $ENV_FILE"

BASE_URL="http://127.0.0.1:${PORT}"

cd "$ROOT_DIR"

log "Stopping existing Docker stack (if running)"
docker compose down --remove-orphans >/dev/null 2>&1 || true

log "Starting profile '$PROFILE' on $BASE_URL"
DEMO_ENV_FILE=".env.demo.${PROFILE}" PORT="$PORT" docker compose up --build -d

for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 1
done

[ "${code:-000}" = "200" ] || {
  docker compose logs --tail=120 api || true
  fail "Server did not become healthy at $BASE_URL"
}

log "Running preflight with matching env profile"
bash "$ROOT_DIR/scripts/preflight_demo.sh" "$ENV_FILE" "$BASE_URL"

log "Gate passed. API is running at $BASE_URL"
