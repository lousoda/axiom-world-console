# Architecture (ASCII)

This file is a compact architecture snapshot for judges, submission forms, and demo narration.

## 1) System Diagram

```text
                           +-----------------------------+
                           |        Judge Browser        |
                           |  https://...ui.fly.dev      |
                           +--------------+--------------+
                                          |
                                          | HTTPS
                                          v
                           +-----------------------------+
                           |           UI App            |
                           |  Vite build + Caddy/Fly     |
                           |  Tabs: WORLD/TRACE/EXPLAIN  |
                           +--------------+--------------+
                                          |
                                          | /api/* proxy
                                          v
                           +-----------------------------+
                           |        FastAPI Backend      |
                           |   https://...api.fly.dev    |
                           +--------------+--------------+
                                          |
                +-------------------------+--------------------------+
                |                         |                          |
                v                         v                          v
      +--------------------+   +----------------------+   +----------------------+
      | Auth Guard Layer   |   | World Engine Core    |   | Explain/Trace Layer  |
      | X-World-Gate       |   | tick/auto/policy     |   | logs + forensic tags |
      | Session cookie     |   | constraints/cooldown |   | DENIAL/COOLDOWN/...  |
      +---------+----------+   +----------+-----------+   +----------+-----------+
                |                         |                          |
                +------------+------------+-------------+------------+
                             |                          |
                             v                          v
                 +-----------------------+   +-----------------------+
                 | Monad Entry Gate      |   | Snapshot Persistence  |
                 | tx hash verification  |   | /persist/save|load    |
                 | chain/rpc/treasury    |   | world_snapshot.json   |
                 +-----------+-----------+   +-----------+-----------+
                             |                           |
                             v                           v
                 +-----------------------+   +-----------------------+
                 | Monad RPC             |   | Determinism Artifacts |
                 | rpc.monad.xyz         |   | ARTIFACTS/*.json      |
                 +-----------------------+   +-----------------------+
```

## 2) Runtime Modes

```text
Local deterministic mode
  ALLOW_FREE_JOIN=true
  No external RPC dependency
  Best for reliable demo recording

Live token-gated mode
  ALLOW_FREE_JOIN=false
  Requires valid tx hash and Monad RPC reachability
  Used when judges request strict on-chain gate behavior
```

## 3) Security Surface (Demo-Relevant)

```text
Read path:
  GET /metrics
  -> 401 without X-World-Gate (if read guard enabled)
  -> 200 with valid key/session

Mutating path:
  POST /scenario/basic_auto
  POST /auto/tick
  -> 401 without valid key/session
  -> 200 with valid key/session

Debug:
  GET /debug/info
  -> expected 404 in hardened demo profile
```

## 4) One-Line Narrative

```text
UI visualizes deterministic multi-agent world evolution; API enforces auth and optional Monad token-gated entry; TRACE/EXPLAIN provide reproducible forensic evidence.
```

