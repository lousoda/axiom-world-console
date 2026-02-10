# UI Execution Checklist (Freeze-Safe)

This is the practical implementation checklist for UI delivery after backend freeze.

## 1) Non-Negotiable Rules

1. Do not change backend core logic in `app.py` for UI work.
2. Preserve deterministic backend operations and current auth protocol.
3. No scope expansion beyond current MVP mechanics in this phase.
4. UI must be understandable by judges without terminal usage.

## 2) Scope: Must / Should / Bonus

### Must (submission-critical)

1. Single-page UI in `ui/`.
2. Auth key input for `X-World-Gate`.
3. Graph panel (agents + locations, agent->location edges).
4. Controls:
   - `Load basic_auto`
   - `Auto tick x1`
   - `Auto tick x10`
   - `Refresh`
5. Sidebar sections:
   - `/world` snapshot
   - `/explain/recent` lines
6. Polling loop at `500-1000ms` with safe error handling.
7. Visible status badges for:
   - `OK`
   - `401 Unauthorized`
   - `402 Payment required`
   - `409 Replay blocked`
   - `429 Rate-limited`

### Should (strongly recommended)

1. Event highlighting in graph for recent actions.
2. Simple loading/disabled states on action buttons.
3. Backoff when receiving `429`.
4. Compact "Judge flow" instructions on-screen.

### Bonus (only if time remains)

1. Transfer event edge visualization.
2. Small timeline strip for recent decisions.
3. Themed motion polish (without heavy dependencies).

## 3) Delivery Phases and Timing

1. Phase A (1-2h): Scaffold UI project and wire API client.
2. Phase B (3-4h): Implement controls + world/explain panels + graph rendering.
3. Phase C (2-3h): UX polish, status handling, rate-limit-safe polling.
4. Phase D (1-2h): Manual QA gate and freeze.

## 4) Technical Decision (Current)

Use `React + vis-network` for balance of speed, stability, and maintainability.

## 5) QA Gates Before UI Freeze

1. Local UI can run and connect to backend.
2. Core judge flow works from UI:
   - load scenario
   - tick x1 / x10
   - observe graph and explain logs update
3. No JS runtime crashes in browser console during 10-minute run.
4. API not flooded:
   - polling stays within configured rate limits
   - `429` handled gracefully
5. Existing backend tests and scripts remain green.

## 6) Risk Controls

1. Keep mutating actions operator-driven from UI controls only.
2. Keep Fly API as source of truth; do not alter key protocol.
3. Do not introduce new backend endpoints in this phase.
4. If UI is blocked by CORS/domain issues, use same-origin proxy strategy.

## 7) Definition of Done

1. UI shows autonomy, constraints, and adaptation in under 2 minutes.
2. UI works with current deployed API and auth model.
3. README links to UI run instructions.
4. UI changes are isolated from backend core behavior.
