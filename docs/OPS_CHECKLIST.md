# Ops Checklist (No-Confusion)

Single source of truth for operator notes and quick verification commands.

## 1) Canonical Run Commands

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

## 2) Hard Rules (Avoid Demo Failures)

1. Do not mix profiles in one running session.
2. For each live strict run use a fresh tx hash (`409` on reuse is expected).
3. Use one operator for POST mutations; observers should use read-only endpoints.
4. Keep `--workers 1` only (already enforced by run scripts and compose).

## 3) Quick Status Matrix (Live)

When API runs in live profile:

1. `POST /join` without header -> `401`.
2. `POST /join` with header but without tx -> `402`.
3. `POST /join` with header + fresh tx -> `200`.
4. Reusing same tx -> `409`.

## 4) Fast Stress Sanity (Local)

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

## 5) Handoff to Teammate

Before handoff, include:

1. Current branch and commit hash.
2. Which profile was validated last (`local` or `live`).
3. Last used tx hash list location (`.demo/used_tx_hashes.txt`) for strict runs.

## 6) Fly Deploy Discipline

1. Keep Fly single-machine deterministic behavior.
2. Use immediate strategy to avoid temporary multi-machine rollout for in-memory state:

```toml
[deploy]
  strategy = "immediate"
```

3. After each deploy run:

```bash
flyctl scale count 1
flyctl machine list
curl -sS -i https://world-model-agent-api.fly.dev/
```

## 7) Fly Recovery (Only if Rollout Stuck >2 min)

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

Note:
1. Do not run restart when machine is already `started` with `1/1` checks.
