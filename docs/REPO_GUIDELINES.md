# Repo Guidelines

## Privacy

1. Repo visibility should stay `Private` before first public push.
2. Never commit `.env*` runtime files.
3. Keep `WORLD_GATE_KEY`, `SMOKE_ENTRY_TX_HASH`, and RPC secrets in secret storage.

## Required Script Comments Before Push

1. `scripts/run_demo.sh`: requires `WORLD_GATE_KEY` (when `REQUIRE_API_KEY=true`) and copied `.env.demo.<profile>` file.
2. `scripts/preflight_demo.sh`: live profile needs `SMOKE_ENTRY_TX_HASH` or join will return `402`.
3. `scripts/demo_gate.sh`: needs `WORLD_GATE_KEY`; live also needs `SMOKE_ENTRY_TX_HASH`.
4. `scripts/docker_gate.sh`: requires Docker Compose and `.env.demo.<profile>`; stops existing stack on same project/port.
5. `scripts/determinism_proof.sh`: run only after server is up at `BASE_URL` with the same `WORLD_GATE_KEY`.

## Remote Setup

1. `git remote add origin git@github.com:<YOU>/<REPO>.git`
2. Verify: `git remote -v`
3. First push: `git push -u origin <branch>`

## Pre-Push Checklist

1. `WORLD_GATE_KEY=demo bash scripts/run_demo.sh .env.demo.local`
2. `WORLD_GATE_KEY=demo bash scripts/preflight_demo.sh .env.demo.local http://127.0.0.1:8011`
3. `WORLD_GATE_KEY=demo bash scripts/determinism_proof.sh http://127.0.0.1:8011`

## CI (Optional)

1. Add repo secrets: `WORLD_GATE_KEY`, `SMOKE_ENTRY_TX_HASH`, `MONAD_RPC_URL`, `MONAD_TREASURY_ADDRESS`, `MIN_ENTRY_FEE_WEI`.
2. Keep CI minimal until secrets are configured.
