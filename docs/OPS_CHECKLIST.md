# Ops Checklist

This checklist is an operational constraint system. It exists to eliminate ambiguity during a live demo and to reduce variance in execution.

There are only two valid execution modes:
1. Local deterministic mode
2. Live token-gated mode

Everything else in this document is about protecting those two modes from operator error, race conditions, infra drift, or replay attacks.

## 1) Two-Min Judge Quick Check

The first block defines the minimal safe demonstration surface.

Deterministic local:
```bash
export WORLD_GATE_KEY="demo"
bash scripts/run_demo.sh ./.env.demo.local
bash scripts/determinism_proof.sh http://127.0.0.1:8011
```

Live token-gated:
```bash
export WORLD_GATE_KEY="demo"
export SMOKE_ENTRY_TX_HASH="0x<fresh-64-hex-mainnet-tx>"
bash scripts/demo_gate.sh live 8011
```

**Note:** Live mode adds external dependency risk (RPC instability, network latency). That's why it's optional and gated behind necessity.

## 2) Canonical Run Commands

This section removes "creative improvisation." The canonical commands prevent config drift.

Local profile:

```bash
export WORLD_GATE_KEY="your_key"
bash scripts/docker_gate.sh local 8001
```

Live/strict profile:

```bash
export WORLD_GATE_KEY="your_key"
export SMOKE_ENTRY_TX_HASH="0x<fresh-64-hex-mainnet-tx>"
bash scripts/docker_gate.sh live 8001
```

Stop:

```bash
docker compose down --remove-orphans
```

## 3) Hard Rules

Each rule addresses a specific failure mode. Specifically:
1. Do not mix profiles in one running session.
2. For each live strict run use a fresh tx hash (`409` on reuse is expected).
3. Use one operator for POST mutations; observers should use read-only endpoints.
4. Keep `--workers 1` only (already enforced by run scripts and compose).

## 4) Quick Status Matrix (Live)

When API runs in live profile:

1. `POST /join` without header -> `401`.
2. `POST /join` with header but without tx -> `402`.
3. `POST /join` with header + fresh tx -> `200`.
4. Reusing same tx -> `409`.

## 5) Fast Stress Sanity (Local)

Read burst (should be all `200`):

```bash
seq 1 200 | xargs -I{} -P16 curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/world | sort | uniq -c
```

Write burst (expect `200` and maybe `429` from rate-limit, but no `5xx`):

```bash
for i in $(seq 1 120); do
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:8001/auto/tick?limit_agents=20" -H "X-World-Gate: $WORLD_GATE_KEY"
done | sort | uniq -c
```

## 6) Handoff to Teammate

Before handoff, include:

1. Current branch and commit hash.
2. Which profile was validated last (`local` or `live`).
3. Target URL used in last successful gate run.
4. Last used tx hash list location (`.demo/used_tx_hashes.txt`) for strict runs.

## 7) Fly Deploy Discipline

Keep Fly single-machine deterministic behavior. Use immediate strategy to avoid temporary multi-machine rollout for in-memory state:

```toml
[deploy]
  strategy = "immediate"
```

After each deploy run:

```bash
flyctl scale count 1
flyctl machine list
curl -sS -i https://world-model-agent-api.fly.dev/
```

## 8) Port / Mode Matrix
- Local scripts (`run_demo.sh`, `demo_gate.sh`): port **8011**
- Docker gate (`docker_gate.sh`): port **8001**
- Freeze doc legacy manual uvicorn: port **8001**
- Fly deploy: served over **443/https** via Fly router

## 9) Fly Recovery (Only if Rollout Stuck >2 min)

Normal quick check:

```bash
flyctl machine list
curl -sS -i https://world-model-agent-api.fly.dev/
```

If machine is stuck in `created` or `replacing` and health is not passing:

```bash
flyctl logs --app world-model-agent-api --no-tail
flyctl machine restart 148e65edf44348
flyctl machine list
curl -sS -i https://world-model-agent-api.fly.dev/
```

**Note:** Do not run restart when machine is already `started` with `1/1` checks.

## 10) Determinism Artifact Check

Run reproducibility proof (two runs from reset and hash compare):

```bash
export WORLD_GATE_KEY="diagkey"
bash scripts/determinism_proof.sh http://127.0.0.1:8011
```

Fly variant:

```bash
export WORLD_GATE_KEY="$(tr -d '\n' < .demo/current_fly_key.txt)"
bash scripts/determinism_proof.sh https://world-model-agent-api.fly.dev
```

Expected:
1. Script prints `result: MATCH`.
2. `ARTIFACTS/determinism_proof_<timestamp>.json` is generated.
3. Run hashes in summary are identical.
