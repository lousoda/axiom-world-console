# Submission + Demo Video Checklist

Use this checklist to package the final submission with minimum risk and no last-minute confusion.

## 1) Required Deliverables

1. Public repo URL (main branch).
2. Live UI URL.
3. Live API URL.
4. Demo video (around 2 minutes).
5. Monad integration explanation (where gate is enforced and what is verified).
6. Reproducibility evidence:
   - `scripts/manual_diag.sh` output.
   - determinism artifact (`scripts/determinism_proof.sh` result + JSON artifact).

## 2) Final Verification Commands

Run before submission freeze:

```bash
cd /Users/naturalmetalgear/Documents/world_model_agent
python3 -m pytest -q

cd /Users/naturalmetalgear/Documents/world_model_agent/ui
npm run lint
npm run test
npm run build

cd /Users/naturalmetalgear/Documents/world_model_agent
WORLD_GATE_KEY="$(cat ~/.wma/world_gate_key)" \
bash scripts/manual_diag.sh "https://world-model-agent-ui.fly.dev/api" "$WORLD_GATE_KEY"
unset WORLD_GATE_KEY
```

Expected:
1. tests green;
2. UI lint/test/build green;
3. `PASS=8 WARN=0 FAIL=0` for manual diagnostics.

## 3) 2-Minute Video Script

### 0:00-0:20
1. Open live UI.
2. Show `Validate`:
   - unauthorized path (401 without key/session),
   - authorized path (200 with key/session).

### 0:20-0:55
1. Select scenario (`Proof` or `Breathing`).
2. Click `Load Scene`.
3. Start `LIVE`.
4. Show WORLD graph evolution and focus controls.

### 0:55-1:25
1. Open `TRACE`.
2. Highlight forensic events and tags.

### 1:25-1:45
1. Open `EXPLAIN`.
2. Show decision reasoning per tick.

### 1:45-2:00
1. Open `Judge Layer`.
2. Show checks, build stamp, quick links, and evidence export.

## 4) Recording Hygiene

1. Do not show real keys in terminal or browser.
2. Mask or blur secrets if they appear in screen recording.
3. Keep one operator for mutating endpoints during recording.
4. Avoid stress tests during recording (prevents 429 noise in the story).

## 5) Submission Form Assembly

Prepare these text blocks in advance:

1. **Project summary (2-3 lines):** deterministic multi-agent world + explainability + Monad-gated entry.
2. **Monad integration note (short):**
   - `/join` can enforce tx-hash checks in strict mode;
   - chain/treasury/value are validated via RPC;
   - replay tx hash is rejected (`409`).
3. **Demo evidence links:**
   - repo,
   - live UI,
   - live API,
   - video URL.

## 6) Freeze Commands

```bash
cd /Users/naturalmetalgear/Documents/world_model_agent
git checkout main
git pull origin main
git tag -a judge-freeze-final -m "Judge freeze final"
git push origin main
git push origin judge-freeze-final
```

## 7) Fallback Plan (If Live Fails)

1. Switch to local deterministic profile immediately.
2. Continue narrative: autonomy + determinism + explainability.
3. State clearly: external RPC instability, local deterministic proof still valid.

