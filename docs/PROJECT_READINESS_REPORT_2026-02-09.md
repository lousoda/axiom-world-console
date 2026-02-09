# Project Readiness Report (2026-02-09)

## Executive Verdict

- Backend MVP is runnable by external operators using documented scripts and example env files.
- Local demo flow and live strict flow are both passing in current branch.
- No critical blockers found in repository structure.
- Remaining risks are mostly operational (RPC stability, tx hygiene, submission formalities).

## What Was Verified

1. Repository health:
- Branch: `codex/mvp-stabilization-world-gate`
- Working tree was clean at verification start.

2. Test suite and syntax:
- `./.venv/bin/python -m pytest -q` -> `11 passed`
- `bash -n scripts/run_demo.sh scripts/preflight_demo.sh scripts/demo_gate.sh smoke_test.sh` -> pass

3. Run reproducibility (for other people):
- `WORLD_GATE_KEY=diagkey bash scripts/demo_gate.sh local 8023` -> pass
- `cd /tmp && WORLD_GATE_KEY=diagkey bash /Users/naturalmetalgear/Documents/world_model_agent/scripts/demo_gate.sh local 8024` -> pass
- This confirms path-agnostic script behavior (not tied to one local cwd).

4. Security behavior spot-check:
- `POST /reset` without key -> `401`
- `POST /reset` with `X-World-Gate` -> `200`
- `GET /debug/info` in demo profile -> `404`

5. Live strict flow:
- `WORLD_GATE_KEY=diagkey SMOKE_ENTRY_TX_HASH=<real-mainnet-tx> bash scripts/demo_gate.sh live 8026` -> pass
- Includes RPC reachability and `eth_chainId=143` preflight checks.

## Repo Structure Reality Check

- Present and valid:
  - `scripts/run_demo.sh`
  - `scripts/preflight_demo.sh`
  - `scripts/demo_gate.sh`
  - `.env.demo.local.example`
  - `.env.demo.live.example`
  - `.gitignore`
  - `docs/DEMO_RUNBOOK.md`
  - `docs/DEMO_RISK_REGISTER.md`

- README references above files correctly in current state.

## Current Residual Risks (Non-Critical)

1. External Monad RPC instability can still impact live strict demo.
2. Reusing the same tx hash in strict runs correctly returns `409` (operational process risk, not a code bug).
3. Submission formalities are still pending (public repo link, demo video link, form fields).

## Security Hardening Status

Already implemented:
- Canonical auth: `WORLD_GATE_KEY` + `X-World-Gate`
- Rate limit support on mutating requests
- Debug endpoints defaulted to disabled
- No implicit `.env` autoload in smoke
- No fallback to `.env` in `run_demo.sh`
- Single-worker enforcement in run script

## What To Do Next For “Real Prepared” State

1. Submission readiness:
- Add public remote and verify repository accessibility.
- Prepare final 2-minute demo video link.
- Complete submission form fields with exact evidence references.

2. Operational rigor:
- Keep a fresh tx list for strict runs.
- Lock the demo runbook to one operator for mutating POST endpoints.
- Run local + live gate on final day before recording.

3. Optional low-risk quality improvements:
- Add one script for deterministic capacity-conflict demo narrative (without changing API).
- Add a concise “Judge Checklist” section to README with exact go/no-go commands.

## Summary

The backend MVP is technically stable and demo-ready in the current branch.
The primary remaining work is submission packaging and operational discipline, not core backend correctness.

## Deployment / Monad / Solidity Decision (Research Addendum)

1. Rules alignment (Agent Track + Bounty):
- Agent Track explicitly says no token launch is required.
- For bounties, project must meet the specific bounty PRD.
- Mandatory submission includes public repo, demo video, and Monad integration explanation.
- Contract addresses are required only if applicable.

2. World Model Agent PRD alignment:
- Core requirement is MON token-gated entry to a persistent world with external agent API.
- PRD does not require launching a custom Solidity token/contract as a hard requirement.

3. Practical implication for this project:
- Backend/web app deployment does not need to be "on-chain"; it can be hosted on standard infra.
- Monad requirement is satisfied via real Monad mainnet integration (chain checks + tx verification + entry gating).
- Solidity is optional for this bounty scope unless the team chooses to add contract-based features.

4. Submission form implication:
- Treat "Link to deployed app" as required and provide a public URL.
- If no custom contract is used, document "Contract addresses: N/A (not applicable)" and clearly explain Monad mainnet usage.

5. Recommended plan:
- First ship deployable backend + UI link for submission certainty.
- Keep Solidity as an optional post-MVP enhancement path if time remains and risk budget allows.
