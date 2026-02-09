# World Model Agent — MVP Freeze v1

Built for the **Moltiverse Hackathon (Agent Track)**.

Status: **MVP Freeze v1 (stable)**  
> This document represents the frozen v1 state used for submission. Active development may continue in `README.md` (if present).
> Legacy note: canonical run commands and current auth/header conventions are maintained in `README.md`.

---

## Overview

**World Model Agent** is a stateful multi-agent simulation exposed via a FastAPI backend. Agents operate inside a deterministic world model with explicit time steps, shared constraints, persistence, and explainability.

The project demonstrates:
- Multi-agent world state
- Autonomous agent behavior (goal-driven)
- Persistent simulation snapshots
- Explainable decision traces
- **Real Monad mainnet token-gated entry** (transaction-hash verification)

On-chain logic is intentionally minimal: the blockchain is used as a **proof-of-entry mechanism**, while the world simulation runs off-chain for determinism and auditability.

---

## Requirements

- Python **3.9+**
- macOS / Linux (Windows via WSL is fine)

---

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install fastapi uvicorn pydantic requests python-dotenv
```

---

## Run the Server

```bash
python3 -m uvicorn app:app --host 127.0.0.1 --port 8001 --workers 1
```

If the server is running, you should be able to access:
- API root: `http://127.0.0.1:8001/`
- Swagger UI: `http://127.0.0.1:8001/docs`

---

## Monad Token-Gated Entry

Agent entry is protected by **Monad mainnet transaction verification**.

### Entry tx hash format

- `entry_tx_hash` must be a **real Monad mainnet transaction hash**
- Format: `0x` + **64 hexadecimal characters**
- Placeholder values such as `0x...` will return:
  - `HTTP 400: Invalid entry_tx_hash format`

This strict validation is intentional and confirms real on-chain verification.

### Example

```bash
curl -s http://127.0.0.1:8001/debug/monad

curl -s -X POST http://127.0.0.1:8001/join \
  -H "Content-Type: application/json" \
  -d '{"name":"agent_1","deposit_mon":0,"entry_tx_hash":"0x<64-hex-mainnet-tx>"}'
```

Notes:
- Reusing the same transaction hash will return **HTTP 409 Conflict** (anti-replay protection).
- The join response includes the created agent under `agent` (e.g. `{ "agent": { "id": 1, ... } }`).

---

## Demo Flow (≤ 2 minutes)

```bash
# Reset world
curl -s -X POST http://127.0.0.1:8001/reset

# Load demo scenario (creates multiple agents)
curl -s -X POST http://127.0.0.1:8001/scenario/basic

# Run autonomous simulation
curl -s -X POST http://127.0.0.1:8001/auto/tick
curl -s -X POST http://127.0.0.1:8001/tick

# Inspect world and decisions
curl -s http://127.0.0.1:8001/world
curl -s http://127.0.0.1:8001/explain/recent
```

Optional:
- `POST /demo/run` may be present as a shortcut, but the preferred flow is explicit `/auto/tick` + `/tick`.

---

## Smoke Test

A deterministic smoke test is included to verify the happy-path behavior.

```bash
chmod +x smoke_test.sh
./smoke_test.sh http://127.0.0.1:8001
```

In token-gated mode, provide a real transaction hash:

```bash
SMOKE_ENTRY_TX_HASH=0x<64-hex-mainnet-tx> ./smoke_test.sh http://127.0.0.1:8001
```

---

## API Overview

Core endpoints:
- `POST /join` — add an agent (token-gated)
- `POST /reset` — reset world state
- `POST /tick` — advance world time
- `POST /auto/tick` — advance autonomous simulation
- `POST /auto/step` — single autonomous step
- `POST /scenario/basic` — load demo scenario
- `GET /world` — inspect world state
- `GET /logs` — recent logs
- `GET /explain/recent` — explain recent decisions

Persistence:
- `POST /persist/save`
- `POST /persist/load`
- `GET /persist/status`

Debug:
- `GET /debug/info`
- `GET /debug/source`
- `GET /debug/monad`

---

## Persistence

The world state can be saved and restored via JSON snapshots.

Snapshots include:
- world tick
- agents and locations
- economy state
- used transaction hashes (anti-replay)

Rollback and replay attacks are prevented by design.

---

## Scope Notes

- This repository freezes **MVP v1** for hackathon submission stability.
- On-chain requirements are satisfied via **mainnet transaction-hash verification**; no contract deployment is required.
- Deeper on-chain agent-to-agent interactions and UI enhancements are planned for future versions.

---

## License

MIT
