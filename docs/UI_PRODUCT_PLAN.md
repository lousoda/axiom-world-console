# UI Product Plan (Post-Freeze, Low-Risk)

This plan defines what to add after backend freeze and when to do it while preserving a clear world-model identity.

## 1) Scope and Constraints

- Backend core is frozen. Do not change `app.py` logic for UI delivery.
- Keep deterministic demo behavior and current auth flow (`WORLD_GATE_KEY` + `X-World-Gate`).
- Build UI as a separate product layer, not as a rewrite of backend behavior.
- Do not introduce additional gameplay systems outside current MVP scope in this phase.

## 2) What We Intentionally Reuse (Pattern-Level)

- Judge-first flow: one clear path from start to meaningful output.
- High observability: world snapshot, explain logs, and recent activity visible at once.
- Explicit error UX for `401`, `402`, and `409` so judges understand why a request failed.
- Quickstart framing: minimal steps to reproduce core behavior.

## 3) What We Explicitly Do Not Reuse

- No expansion into combat/faction systems in this phase.
- No copy of visual identity, layout composition, wording, or naming.
- No feature creep into game systems before submission pack is complete.

## 4) Timing (When to Do What)

1. Phase A (now): backend freeze validation and ops discipline only.
2. Phase B (next): UI v1 graph-view with existing endpoints.
3. Phase C (after UI v1): submission pack (video, form, public repo links).
4. Phase D (only if time remains): optional experiments in a separate branch (`x402`, extra scenario, contract spike).

## 5) UI v1 Definition (1-day target)

- Single page in `ui/` with graph-view of agents and locations.
- Controls: `scenario/basic_auto`, `auto/tick x1`, `auto/tick x10`.
- Panels: world snapshot and `/explain/recent`.
- Polling refresh every `500-1000ms`.
- Auth input field for `X-World-Gate` key.

## 6) Anti-Copy Check (Before and After UI Draft)

1. Compare hero/intro text: must describe deterministic world model and explainable autonomy.
2. Compare component layout: must differ in hierarchy and section structure.
3. Compare design language: independent typography, colors, and iconography.
4. Compare naming: use your own terms for flows and controls.
5. Compare feature claims: keep only features implemented in your backend.

## 7) Decision Gate Before Optional Integrations

Proceed to optional integrations only if all are true:

1. Backend gates pass (`pytest`, local/live gates, Fly matrix).
2. UI v1 is usable by a new person without terminal knowledge.
3. Submission artifacts are ready (public repo, video, runbook links).

## 8) Discussion Questions for Team/GPT

1. Is UI v1 enough to make autonomy and explainability obvious in under 2 minutes?
2. Should optional scope be `x402` or a controlled extra scenario first?
3. Can optional changes be isolated in a separate branch without risking demo stability?
