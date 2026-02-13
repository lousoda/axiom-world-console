#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8011}"
SCENARIO_KEY="${SCENARIO_KEY:-autonomy_proof}"
TICKS="${DETERMINISM_TICKS:-25}"
EXPLAIN_LIMIT="${DETERMINISM_EXPLAIN_LIMIT:-200}"
LIMIT_AGENTS="${DETERMINISM_LIMIT_AGENTS:-50}"
HEADER_NAME="${API_KEY_HEADER_NAME:-X-World-Gate}"
ARTIFACT_DIR="${DETERMINISM_ARTIFACT_DIR:-ARTIFACTS}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -z "${WORLD_GATE_KEY:-}" ]]; then
  echo "ERROR: WORLD_GATE_KEY is required." >&2
  echo "Example: export WORLD_GATE_KEY=diagkey" >&2
  exit 1
fi

if ! [[ "${TICKS}" =~ ^[0-9]+$ ]] || [[ "${TICKS}" -le 0 ]]; then
  echo "ERROR: DETERMINISM_TICKS must be a positive integer (current: ${TICKS})." >&2
  exit 1
fi

if ! [[ "${EXPLAIN_LIMIT}" =~ ^[0-9]+$ ]] || [[ "${EXPLAIN_LIMIT}" -le 0 ]]; then
  echo "ERROR: DETERMINISM_EXPLAIN_LIMIT must be a positive integer (current: ${EXPLAIN_LIMIT})." >&2
  exit 1
fi

mkdir -p "${ARTIFACT_DIR}"

request_json() {
  local method="$1"
  local path="$2"
  local out_file="$3"
  local status

  status="$(curl -sS -o "${out_file}" -w "%{http_code}" \
    -X "${method}" \
    "${BASE_URL}${path}" \
    -H "${HEADER_NAME}: ${WORLD_GATE_KEY}" \
    -H "Content-Type: application/json")"

  if [[ "${status}" != "200" ]]; then
    echo "ERROR: ${method} ${path} returned HTTP ${status}" >&2
    cat "${out_file}" >&2
    return 1
  fi
}

run_once() {
  local run_id="$1"
  local tmp_reset tmp_scenario tmp_tick tmp_explain run_hash run_line_count run_artifact parsed_output
  local i

  tmp_reset="$(mktemp)"
  tmp_scenario="$(mktemp)"
  tmp_tick="$(mktemp)"
  tmp_explain="$(mktemp)"

  request_json "POST" "/reset" "${tmp_reset}"
  request_json "POST" "/scenario/${SCENARIO_KEY}" "${tmp_scenario}"

  for i in $(seq 1 "${TICKS}"); do
    request_json "POST" "/auto/tick?limit_agents=${LIMIT_AGENTS}" "${tmp_tick}"
  done

  request_json "GET" "/explain/recent?limit=${EXPLAIN_LIMIT}" "${tmp_explain}"

  parsed_output="$(
    python3 - "${tmp_explain}" <<'PY'
import hashlib
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

lines = payload.get("lines", [])
digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
print(digest)
print(len(lines))
PY
  )"

  run_hash="$(printf "%s\n" "${parsed_output}" | sed -n '1p')"
  run_line_count="$(printf "%s\n" "${parsed_output}" | sed -n '2p')"
  run_artifact="${ARTIFACT_DIR}/determinism_run${run_id}_${TS}.json"
  cp "${tmp_explain}" "${run_artifact}"

  rm -f "${tmp_reset}" "${tmp_scenario}" "${tmp_tick}" "${tmp_explain}"

  echo "${run_hash}|${run_line_count}|${run_artifact}"
}

echo "[determinism] BASE_URL=${BASE_URL}"
echo "[determinism] SCENARIO_KEY=${SCENARIO_KEY} TICKS=${TICKS} LIMIT_AGENTS=${LIMIT_AGENTS} EXPLAIN_LIMIT=${EXPLAIN_LIMIT}"

run1_info="$(run_once 1)"
run2_info="$(run_once 2)"

IFS="|" read -r run1_hash run1_lines run1_path <<< "${run1_info}"
IFS="|" read -r run2_hash run2_lines run2_path <<< "${run2_info}"

result="MISMATCH"
if [[ "${run1_hash}" == "${run2_hash}" ]]; then
  result="MATCH"
fi

summary_path="${ARTIFACT_DIR}/determinism_proof_${TS}.json"
cat > "${summary_path}" <<EOF
{
  "timestamp_utc": "${TS}",
  "base_url": "${BASE_URL}",
  "scenario": "${SCENARIO_KEY}",
  "ticks": ${TICKS},
  "limit_agents": ${LIMIT_AGENTS},
  "explain_limit": ${EXPLAIN_LIMIT},
  "header_name": "${HEADER_NAME}",
  "run_1": {
    "hash_sha256": "${run1_hash}",
    "line_count": ${run1_lines},
    "artifact_path": "${run1_path}"
  },
  "run_2": {
    "hash_sha256": "${run2_hash}",
    "line_count": ${run2_lines},
    "artifact_path": "${run2_path}"
  },
  "result": "${result}"
}
EOF

echo "[determinism] run_1 hash: ${run1_hash} (lines=${run1_lines})"
echo "[determinism] run_2 hash: ${run2_hash} (lines=${run2_lines})"
echo "[determinism] result: ${result}"
echo "[determinism] summary artifact: ${summary_path}"

if [[ "${result}" != "MATCH" ]]; then
  exit 2
fi
