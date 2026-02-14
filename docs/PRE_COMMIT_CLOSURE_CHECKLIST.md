# Pre-Commit Closure Checklist

Use this checklist before handing off to teammate or making the release commit.

## 1) Runtime and Security

1. API key guard active on read + write endpoints.
2. Debug endpoints disabled in deploy target.
3. `scripts/manual_diag.sh` result: `PASS=8 WARN=0 FAIL=0` for target URL.
4. No secrets shown in terminal screenshots or committed files.

## 2) UI Readiness

1. UI loads from public URL and `Validate Link` returns `200` with valid key.
2. `/api` proxy path works from UI host.
3. FLOW (`LIVE`, `PAUSE`, `ACCELERATE`) behaves correctly for at least 10 cycles.
4. TRACE and EXPLAIN tabs show fresh events after scenario load.

## 3) Performance Baseline

1. UI remains responsive during 10-minute LIVE run.
2. Graph update cadence is stable and does not freeze controls.
3. No recurring `429`/`5xx` in normal demo pace.

## 4) Docs and Handoff

1. `README.md` links to current runbooks/checklists.
2. `docs/DEMO_RUNBOOK.md`, `docs/OPS_CHECKLIST.md`, and `docs/DEMO_RISK_REGISTER.md` are aligned.
3. Handoff note includes: validated profile (`local`/`live`), target URL, last gate run timestamp.

## 5) Commit Hygiene

1. `python3 -m pytest -q` passes.
2. `cd ui && npm run lint && npm run test` passes.
3. `git status` reviewed; no accidental temp files or secrets.
4. Commit message clearly states scope (UI/docs/security/deploy).
