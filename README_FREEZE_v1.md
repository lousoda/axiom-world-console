# AXIOM — World Model Agent (MVP)

AXIOM is a deterministic world simulation server: an explicit world state, tick-based execution, and rule-driven autonomy.

Built for the **Moltiverse Hackathon (Agent Track)**. Monad integration is a planned next step.

Status: **MVP Freeze v1 (stable)**  
No refactors or new features unless explicitly required for the submission.

The MVP includes a minimal economy loop, autonomous agents, and JSON snapshot persistence.

This MVP demonstrates:
1. A world-model + policy loop (agent decides → world applies) that stays inspectable.
2. Deterministic, rule-based autonomy (idle / wander / earn) with explainability.
3. Persistence (save/load) so the same world can be resumed and replayed.

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
