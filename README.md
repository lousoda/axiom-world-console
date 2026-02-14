# World Model Agent (MVP)

Stateful multi-agent world simulation backend built for the Moltiverse / Monad hackathon.

## What This MVP Demonstrates

- Deterministic world-state simulation with explicit `tick` progression
- Goal-driven autonomous agents (`earn`, `wander`, `idle`)
- Snapshot persistence (`/persist/save`, `/persist/load`)
- Explainability endpoints (`/explain/recent`, `/explain/agent/{id}`)
- Monad token-gated entry via transaction hash verification (live profile)

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

## Demo Profiles

Create profile files from examples:

```bash
cp .env.demo.local.example .env.demo.local
cp .env.demo.live.example .env.demo.live
```

- `.env.demo.local`: stable demo mode without external RPC dependency (`ALLOW_FREE_JOIN=true`)
- `.env.demo.live`: token-gated mode with external Monad RPC checks (`ALLOW_FREE_JOIN=false`)

Do not commit .env* files; only commit *.example.

## Project Map (Judge-Friendly)

Canonical instructions live in this file: `README.md`.

Required for demo run and verification:
- `app.py`
- `scripts/run_demo.sh`
- `scripts/preflight_demo.sh`
- `smoke_test.sh`
- `.env.demo.local.example`
- `.env.demo.live.example`
- `tests/`

Supporting (helpful, but not required for core API demo):
- `scripts/demo_gate.sh`
- `docs/DEMO_RUNBOOK.md`
- `docs/DEMO_RISK_REGISTER.md`
- `README_FREEZE_v1.md` (archive snapshot)

Operational / generated artifacts:
- `.demo/`
- `ARTIFACTS/`
- `world_snapshot.json`

## Demo Ops

- Risk register: `docs/DEMO_RISK_REGISTER.md`
- Runbook: `docs/DEMO_RUNBOOK.md`
- Ops checklist (single source for operator notes + sanity commands): `docs/OPS_CHECKLIST.md`
- UI/product differentiation plan (post-freeze): `docs/UI_PRODUCT_PLAN.md`
- UI execution checklist (must/should/bonus + QA gates): `docs/UI_EXECUTION_CHECKLIST.md`
- UI public deploy runbook (static host + proxy routing): `docs/UI_PUBLIC_DEPLOY_RUNBOOK.md`
- Repo handoff/push discipline: `docs/REPO_GUIDELINES.md`
- Pre-commit closure list: `docs/PRE_COMMIT_CLOSURE_CHECKLIST.md`
- One-command gate: `scripts/demo_gate.sh`

Quick gate runs:

```bash
export WORLD_GATE_KEY="your_key"
bash scripts/demo_gate.sh local 8011

export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
bash scripts/demo_gate.sh live 8011
```

## Demo (local)

```bash
export WORLD_GATE_KEY="your_key"
cp .env.demo.local.example .env.demo.local
bash scripts/run_demo.sh .env.demo.local
# in another terminal:
export WORLD_GATE_KEY="your_key"
bash scripts/preflight_demo.sh .env.demo.local
```

## Demo (live/strict)

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-tx-hash>"
cp .env.demo.live.example .env.demo.live
bash scripts/run_demo.sh .env.demo.live
# in another terminal:
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-tx-hash>"
bash scripts/preflight_demo.sh .env.demo.live
```

## Docker (local demo profile)

```bash
export WORLD_GATE_KEY="your_key"
cp .env.demo.local.example .env.demo.local
docker compose up --build
```

In another terminal:

```bash
export WORLD_GATE_KEY="your_key"
bash scripts/preflight_demo.sh .env.demo.local http://127.0.0.1:8001
```

Stop container:

```bash
docker compose down
```

Recommended no-confusion one-command flow:

```bash
export WORLD_GATE_KEY="your_key"
bash scripts/docker_gate.sh local 8001
```

## Docker (live/strict profile)

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
cp .env.demo.live.example .env.demo.live
DEMO_ENV_FILE=.env.demo.live docker compose up --build
```

In another terminal:

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
bash scripts/preflight_demo.sh .env.demo.live http://127.0.0.1:8001
```

Recommended no-confusion one-command flow:

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
bash scripts/docker_gate.sh live 8001
```

Notes:
- Docker launch keeps `--workers 1` for deterministic in-memory state.
- Keep secrets in shell env; do not commit `.env.demo.local` / `.env.demo.live`.

## Fly.io Deploy (API only)

Authenticate once:

```bash
flyctl auth login
flyctl auth whoami
```

Create app (first time only):

```bash
flyctl apps create world-model-agent-api
```

Set runtime secrets (example live profile):

```bash
flyctl secrets set \
WORLD_GATE_KEY="your_key" \
ALLOW_FREE_JOIN="false" \
REQUIRE_API_KEY="true" \
API_KEY_HEADER_NAME="X-World-Gate" \
DEBUG_ENDPOINTS_ENABLED="false" \
RATE_LIMIT_ENABLED="true" \
RATE_LIMIT_MAX_REQUESTS="100" \
RATE_LIMIT_WINDOW_SEC="60" \
MONAD_CHAIN_ID="143" \
MONAD_RPC_URL="https://rpc.monad.xyz" \
MONAD_TREASURY_ADDRESS="0x833dD2b2c4085674E57B058126DD59235D893a2e" \
MIN_ENTRY_FEE_WEI="10000000000000000"
```

Note: `fly.toml` uses immediate deploy strategy to reduce temporary multi-machine rollout for in-memory state:

```toml
[deploy]
  strategy = "immediate"
```

Deploy:

```bash
flyctl deploy --remote-only
flyctl scale count 1
flyctl status
```

## Recommended Run Commands

Start server (single worker, deterministic in-memory state):

```bash
./scripts/run_demo.sh ./.env.demo.local
```

Run preflight + smoke against the running server:

```bash
./scripts/preflight_demo.sh ./.env.demo.local http://127.0.0.1:8011
```

For live profile:

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
./scripts/run_demo.sh ./.env.demo.live
./scripts/preflight_demo.sh ./.env.demo.live http://127.0.0.1:8011
```

## Deterministic Proof Artifact

Generate a reproducibility artifact (two identical runs from reset, hashed from `explain/recent` lines):

```bash
export WORLD_GATE_KEY="diagkey"
bash scripts/determinism_proof.sh http://127.0.0.1:8011
```

Optional tuning:

```bash
export DETERMINISM_TICKS=25
export DETERMINISM_EXPLAIN_LIMIT=200
export DETERMINISM_LIMIT_AGENTS=50
```

Output:

1. `MATCH` means run 1 and run 2 hashes are identical.
2. `MISMATCH` means non-identical traces (or mismatched starting conditions).
3. Artifacts are written to `ARTIFACTS/`:
   - `determinism_run1_<timestamp>.json`
   - `determinism_run2_<timestamp>.json`
   - `determinism_proof_<timestamp>.json`

## Manual / Legacy Commands (Reference)

These are direct commands already used during verification:

```bash
# Basic local run
ALLOW_FREE_JOIN=true python3 -m uvicorn app:app --host 127.0.0.1 --port 8011

# Hardened run
ALLOW_FREE_JOIN=true REQUIRE_API_KEY=true WORLD_GATE_KEY="$WORLD_GATE_KEY" RATE_LIMIT_ENABLED=true RATE_LIMIT_MAX_REQUESTS=100 RATE_LIMIT_WINDOW_SEC=60 DEBUG_ENDPOINTS_ENABLED=false python3 -m uvicorn app:app --host 127.0.0.1 --port 8011 --workers 1

# Smoke checks
bash -n smoke_test.sh
./smoke_test.sh http://127.0.0.1:8011
SMOKE_API_KEY="$WORLD_GATE_KEY" ./smoke_test.sh http://127.0.0.1:8011

# Unauthorized mutation check (should return 401 when API key is required)
curl -sS -o /tmp/reset_no_key.json -w "%{http_code}" -X POST http://127.0.0.1:8011/reset
```

## Judge Demo Runbook

`T-15 min`

1. Start server with `./scripts/run_demo.sh ./.env.demo.local`
2. Run preflight: `./scripts/preflight_demo.sh ./.env.demo.local http://127.0.0.1:8011`
3. If preflight fails due to external dependency in live mode, switch to `.env.demo.local`

`T-5 min`

1. Keep one terminal with running server only
2. Keep one terminal ready for demo cURL commands

`Go/No-Go`

- `GO`: `GET /` is `200` and smoke test passes
- `NO-GO`: smoke or health fails; restart with local profile and rerun preflight

`Fallback`

- If RPC/faucet/external infra is unstable, use `.env.demo.local`
- Explain to judges: external infra degraded, switched to deterministic local mode

## API Highlights

- `POST /join`
- `POST /act`
- `POST /tick`
- `POST /auto/tick`
- `POST /persist/save`
- `POST /persist/load`
- `GET /world`
- `GET /logs`
- `GET /explain/recent`

## Submission Evidence (for Judges)

**Track:** Agent Track / Bounty scope (no token launch required)

**What is demonstrated**
- Deterministic, stateful multi-agent world simulation (tick-based)
- Autonomous agents with goal-driven behavior (earn / wander / idle)
- Agent-to-agent interactions (transfer)
- Economy constraints (capacity, costs) with explainability
- Persistence with safe snapshot load/save
- Monad token-gated entry (402-style flow) in live profile
- Local fallback profile is available for infra-safe demo rehearsals

**Monad Integration (Mainnet)**
- Chain ID: 143 (Monad mainnet)
- RPC: https://rpc.monad.xyz
- Token-gated entry via transaction hash verification
- Treasury receives entry payments (configured via env)

**Proof Artifacts**
- Demo video (≤ 2 minutes): attached in submission package
- Example mainnet transaction hash verified in smoke:
  - `0x2987fa5798f7f0731b0ab3d573940b00a2b5a291e941fa86e359080c14d45286`
- Treasury address:
  - `0x833dD2b2c4085674E57B058126DD59235D893a2e`

**How to Verify Quickly**
1. Preferred: run one-command gate:
   ```bash
   export WORLD_GATE_KEY="your_key"
   export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
   ./scripts/demo_gate.sh live 8011
   ```
2. Start server with local profile:
   ```bash
   ./scripts/run_demo.sh ./.env.demo.local
   ```
3. Run preflight + smoke:
   ```bash
   ./scripts/preflight_demo.sh ./.env.demo.local http://127.0.0.1:8011
   ```
4. Run live strict token-gated verification (required for bounty proof):
   ```bash
   export WORLD_GATE_KEY="your_key"
   export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
   ./scripts/run_demo.sh ./.env.demo.live
   ./scripts/preflight_demo.sh ./.env.demo.live http://127.0.0.1:8011
   ```
5. Strict token-gated smoke (must include real tx hash):
   ```bash
   SMOKE_API_KEY="$WORLD_GATE_KEY" STRICT_TOKEN_GATE=true SMOKE_ENTRY_TX_HASH="$SMOKE_ENTRY_TX_HASH" ./smoke_test.sh http://127.0.0.1:8011
   ```

**Explainability**
- Use `GET /explain/recent` to inspect autonomous decisions and economy constraints
- Logs are deterministic and bounded for demo safety

## Notes

- Freeze document is a historical snapshot and may lag current run scripts: `README_FREEZE_v1.md`
- This MVP is intentionally minimal and optimized for demo clarity, reproducibility, and judging.
