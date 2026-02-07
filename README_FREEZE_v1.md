# AXIOM — World Model Agent (MVP)

AXIOM is a deterministic world simulation server: an explicit world state, tick-based execution, and rule-driven autonomy.

Built for the **Moltiverse Hackathon (Agent Track)**. Includes verified **Monad mainnet token‑gated entry**.

Status: **MVP Freeze v1 (stable)**  

---

## Monad Mainnet Integration (Verified)

This MVP includes a minimal, production‑valid integration with **Monad mainnet** to satisfy the Agent Track on‑chain requirement.

**What is implemented:**
- MON token‑gated world entry
- On‑chain payment proof via transaction hash
- Anti‑replay protection (tx hash cannot be reused)
- Persistence‑safe verification (replay protection survives save/load)

**Network:** Monad Mainnet (chainId `143`)

**Treasury:** `0x833dD2b2c4085674E57B058126DD59235D893a2e`

**Minimum entry fee:** `0.01 MON`

**Example proof transaction:**
`0xd2f38f1619f1c3342f76af4c5283f4845bfcdbc008823d343783f860af1a55a9`

Verification is visible via:
- `GET /debug/monad`
- `GET /explain/recent`

---

## What it does

AXIOM exposes its world state (tick, locations, agents, logs, action queue) so external clients/agents can:
- enter the world (`/join`, `/scenario/basic`)
- query state (`/world`, `/agents/{id}`, `/metrics`)
- submit actions (`/act`)

World changes via discrete ticks (`/tick`).

---

## Autonomy v1

Actions:
- **earn** — go to workshop and earn
- **wander** — move around locations
- **idle** — no action

Cooldown prevents decision spam (at most one decision per tick per agent).

Explainability:
- `GET /explain/recent`
- `GET /explain/agent/{id}`  
These endpoints show *why* actions happened.

Persistence:
- `POST /persist/save`
- `POST /persist/load`
- `GET /persist/status`

---

## Demo in 60 seconds

### Monad token‑gated entry demo

```bash
curl -s http://localhost:8001/debug/monad

curl -s -X POST http://localhost:8001/join \
  -H "Content-Type: application/json" \
  -d '{"name":"alice","deposit_mon":0,"entry_tx_hash":"0xd2f38f1619f1c3342f76af4c5283f4845bfcdbc008823d343783f860af1a55a9"}'

curl -s "http://localhost:8001/explain/recent?limit=20"
```

This demonstrates real on‑chain verification and deterministic replay protection.

Start the server:
```bash
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Load the demo scenario:
```bash
curl -s -X POST http://127.0.0.1:8000/scenario/basic | python3 -m json.tool
```

Run a short autonomous simulation:
```bash
curl -s -X POST http://127.0.0.1:8000/demo/run | python3 -m json.tool
```

Inspect why actions happened:
```bash
curl -s http://127.0.0.1:8000/explain/recent | python3 -m json.tool
```

---

## Core Features

### World State
- locations: spawn, market, workshop
- global tick counter
- action queue

### Agents
- position, balance, inventory
- optional autonomous mode

### Actions
- move
- earn (only in workshop)
- say

### Persistence
- JSON snapshot save / load
- deterministic restore after reset

### Explainability
- human-readable event explanations

---

## Autonomous Behavior (v1)

Agents operate in a shared environment and can:
- decide actions based on world state
- enqueue actions autonomously
- execute behavior step-by-step via ticks

Behavior rules are explicit and deterministic to keep the system transparent and inspectable.

---

## API Overview

Main endpoints:
- `POST /join` — add an agent
- `POST /tick` — advance world time
- `POST /scenario/basic` — load demo scenario
- `POST /demo/run` — run autonomous demo
- `POST /persist/save` — save world snapshot
- `POST /persist/load` — load snapshot
- `GET /world` — inspect world state
- `GET /explain/recent` — explain recent actions

Swagger UI: `http://127.0.0.1:8000/docs`

---

## Quickstart

### Setup environment
```bash
cd /path/to/world_model_agent
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install fastapi uvicorn pydantic
```

### Run server
```bash
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

This starts a stateful world process in memory; the world advances only when you call `/tick`.

### Verify setup (debug)
```bash
curl -s http://127.0.0.1:8000/debug/info | python3 -m json.tool
```

If this endpoint responds, the agent world is live and ready for interaction.

---

## Project Scope Notes

- This repository freezes **MVP v1** for hackathon submission stability.
- Economy tuning, autonomy improvements, and A2A interactions are planned as **V2** work.
- Monad integration is intentionally minimal and non‑invasive to preserve determinism and auditability.
