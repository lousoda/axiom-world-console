# Demo Runbook

This runbook is structured to demonstrate three things in a controlled, time-bounded way: (*a.*) autonomy, where agents act without manual orchestration; (*b.*) determinism, where identical inputs produce identical outputs; and (*c.*) operational discipline with clear go/no-go criteria and fallback paths.

## 1) Default Path

The default flow runs entirely locally with a single worker. Matching hashes confirm that world state evolution is stable and reproducible. Artifacts are stored for inspection. Refer to `README.md`.

1. Set key and start server (single worker enforced):
```bash
export WORLD_GATE_KEY="demo"
bash scripts/run_demo.sh ./.env.demo.local
```
2. Prove determinism (two runs, hashed):
```bash
export WORLD_GATE_KEY="demo"
bash scripts/determinism_proof.sh http://127.0.0.1:8011
```
   - Say: "Both runs hash-identically; artifacts are in ARTIFACTS/."
3. Show autonomy:
```bash
curl -sS -X POST "http://127.0.0.1:8011/auto/tick"
curl -sS http://127.0.0.1:8011/world
curl -sS http://127.0.0.1:8011/explain/recent
```
   - Point at agent choices + explain tags (`DENIAL`, `COOLDOWN`, etc.) without extra commands.

## 2) Live Token-Gated Path

The live path is optional and only used if judges require mainnet validation. Here, entry is gated by a transaction hash. The system verifies eligibility before allowing participation.

1. Export secrets and fresh tx hash:
```bash
export WORLD_GATE_KEY="demo"
export SMOKE_ENTRY_TX_HASH="0x<64-hex-mainnet-tx>"
```
2. Run gate (includes strict join and smoke):
```bash
bash scripts/demo_gate.sh live 8011
```
3. If gate passes, optionally rerun determinism proof against live URL; if RPC is unstable, declare fallback to local deterministic mode.

## 3) Go / No-Go

- GO: `demo_gate.sh` passes and strict join shows `401` -> `402` -> `200` with fresh tx hash.
- NO-GO: preflight fails, RPC chain check fails, or strict join cannot complete; immediately switch to local path and say why.

## 4) Hygiene

- Record each live tx hash locally (never commit):
```bash
mkdir -p .demo
echo "$(date -u +%FT%TZ) 0x<tx_hash>" >> .demo/used_tx_hashes.txt
```
- One operator only for POST mutations; observers stay read-only.

## 5) UI/Public Handoff

- Before live demo, confirm the public UI can reach the API from the planned URL. If serving static UI, ensure `/api/*` proxy is active and CORS is clean (see `docs/UI_PUBLIC_DEPLOY_RUNBOOK.md`).
- If proxy fails, pivot to local UI (`npm run dev`) pointed at the same API and explain the fallback to judges.

## 6) Timeboxes

The timeboxes ensure the demo fits inside two minutes:
- T-10: choose profile, export keys, start server.
- T-8: run `demo_gate.sh` (live) or `run_demo.sh` / `preflight_demo.sh` (local).
- T-6: run `determinism_proof.sh`.
- T-3: open `/world` and `/explain/recent` for live view.
- T-0: deliver autonomy and determinism narrative.
