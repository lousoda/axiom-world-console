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
./scripts/run_demo.sh ./.env.demo.live
./scripts/preflight_demo.sh ./.env.demo.live http://127.0.0.1:8011
```

## Manual / Legacy Commands (Reference)

These are direct commands already used during verification:

```bash
# Basic local run
ALLOW_FREE_JOIN=true python3 -m uvicorn app:app --host 127.0.0.1 --port 8011

# Hardened run
ALLOW_FREE_JOIN=true REQUIRE_API_KEY=true WORLD_API_KEY=devsecret RATE_LIMIT_ENABLED=true RATE_LIMIT_MAX_REQUESTS=100 RATE_LIMIT_WINDOW_SEC=60 DEBUG_ENDPOINTS_ENABLED=false python3 -m uvicorn app:app --host 127.0.0.1 --port 8011 --workers 1

# Smoke checks
bash -n smoke_test.sh
./smoke_test.sh http://127.0.0.1:8011
SMOKE_API_KEY=devsecret ./smoke_test.sh http://127.0.0.1:8011

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
1. Start server with local profile:
   ```bash
   ./scripts/run_demo.sh ./.env.demo.local
   ```
2. Run preflight + smoke:
   ```bash
   ./scripts/preflight_demo.sh ./.env.demo.local http://127.0.0.1:8011
   ```
3. (Optional) Switch to live profile for token-gated join:
   ```bash
   ./scripts/run_demo.sh ./.env.demo.live
   ./scripts/preflight_demo.sh ./.env.demo.live http://127.0.0.1:8011
   ```
4. Strict token-gated smoke (must include real tx hash):
   ```bash
   SMOKE_API_KEY=devsecret STRICT_TOKEN_GATE=true SMOKE_ENTRY_TX_HASH=0x2987fa5798f7f0731b0ab3d573940b00a2b5a291e941fa86e359080c14d45286 ./smoke_test.sh http://127.0.0.1:8011
   ```

**Explainability**
- Use `GET /explain/recent` to inspect autonomous decisions and economy constraints
- Logs are deterministic and bounded for demo safety

## Notes

- Freeze document: `/Users/naturalmetalgear/Documents/world_model_agent/README_FREEZE_v1.md`
- This MVP is intentionally minimal and optimized for demo clarity, reproducibility, and judging.
