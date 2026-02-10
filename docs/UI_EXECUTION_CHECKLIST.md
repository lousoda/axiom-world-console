# UI Execution Checklist (World Console)

This file is the practical implementation checklist for the UI layer.
Backend behavior is frozen and must not be changed.

## 1) Hard Constraints (Non-Negotiable)

1. UI is an observation interface, not a direct control dashboard.
2. UI must not expose `step`, `tick`, `x1`, `x10` wording.
3. UI must use FLOW controls only:
   - `LIVE`
   - `PAUSE`
   - `ACCELERATE`
4. Internal calls to `/auto/tick` are allowed, but endpoint naming must stay hidden in UI copy.
5. Do not expose direct agent action controls:
   - no `/act`
   - no `/market/buy`
6. Allowed user interactions in UI:
   - scenario load
   - FLOW modulation
7. Use existing backend endpoints only.
8. Preserve deterministic trust and explainability.

## 2) Fixed Stack

1. Frontend: React (Vite), `vis-network`, HTML canvas for custom node rendering.
2. Backend: existing FastAPI endpoints only.
3. Avoid new libraries unless strictly necessary for delivery.
4. Do not add animation frameworks or heavy visual effects.

## 2.1) Baseline File Structure

```text
/ui
  /src
    /api
      client.ts
    /flow
      flowController.ts
      flowPolicy.ts
    /model
      stateFieldMapper.ts
      traceNormalizer.ts
    /graph
      GraphView.tsx
      graphAdapter.ts
      NodeRenderer.ts
    /panels
      WorldPanel.tsx
      TracePanel.tsx
      ExplainPanel.tsx
      StatusBadges.tsx
    /copy
      vocabulary.ts
    /types
      index.ts
    /styles
      theme.css
    App.tsx
    main.tsx
```

## 2.2) Tool Responsibilities

1. React:
   - layout
   - tabs
   - panels
   - FLOW controls
2. vis-network:
   - graph layout
   - node positioning
   - edge routing
3. HTML canvas:
   - node body rendering only (density, structure, weight)
   - no control widgets, no panel text
4. CSS:
   - tone
   - spacing rhythm
   - restrained visual hierarchy

## 3) Canonical UI Terms (Must Use)

1. UI name: `World Console`
2. Tabs:
   - `WORLD`
   - `TRACE`
   - `EXPLAIN`
   - `STATUS` (optional)
3. Graph semantics:
   - `State Nodes`
   - `Influence Edges`
4. Trace naming:
   - `Deferred Trace`
   - `Explainability Trace`
5. Whisper vocabulary:
   - `inertia`
   - `pressure`
   - `latency`
   - `threshold`
   - `drift`
   - `convergence`
   - `resistance`
   - `imbalance`

## 4) Forbidden UI Language

1. Anthropomorphic phrasing:
   - avoid "agent thinks/wants/decides"
2. Game framing:
   - avoid game-like wording or command fantasy
3. Lore/marketing prose:
   - keep text technical, concise, forensic

## 5) Phase-by-Phase Plan

### Phase 1 — Scaffold

1. Create React app under `ui/` (Vite).
2. Build single-page layout.
3. Top bar includes:
   - API Base URL input
   - `X-World-Gate` input
   - `Connect/Test` button (`GET /metrics`)
4. Add status badges for:
   - `200`
   - `401`
   - `402`
   - `409`
   - `429`
5. No graph polish in this phase.

Exit criteria:
1. UI can connect and report status codes correctly.

### Phase 2 — Flow Engine

1. Implement FLOW modes:
   - `PAUSE`: no loop
   - `LIVE`: ~900ms loop
   - `ACCELERATE`: ~300ms loop
2. Loop sequence:
   - `POST /auto/tick`
   - `GET /world`
   - `GET /metrics`
   - `GET /logs` (recent)
   - `GET /explain/recent` (reduced cadence)
3. Stop FLOW on `401`, `402`, `409`.
4. Backoff strategy on `429`.
5. Guarantee only one loop instance runs at a time.

Exit criteria:
1. Flow is stable for 10 minutes without race behavior.

### Phase 3 — World Console Layout

1. Tabs: `WORLD`, `TRACE`, `EXPLAIN`.
2. `WORLD` tab:
   - central graph
   - side snapshot panels for `/world` and `/metrics`
   - optional whisper overlay
3. `TRACE` tab:
   - `Deferred Trace` from `/logs`
   - newest first, compact view
4. `EXPLAIN` tab:
   - `Explainability Trace` from `/explain/recent`
   - structured forensic readability

Exit criteria:
1. Judge can observe state evolution without extra clicks.

### Phase 4 — Graph Semantics

1. Use `vis-network` layout.
2. Represent state-field, not characters/entities.
3. Node labels should be restrained and non-anthropomorphic.
4. Edges are secondary and influence-oriented.

Exit criteria:
1. Graph reads as system state, not character UI.

### Phase 5 — Node Visual Mass (Canvas)

1. Add custom canvas node rendering.
2. Node visual qualities:
   - dense
   - asymmetrical
   - heavier core, lighter perimeter
3. Keep palette muted (2-3 palettes max).
4. Avoid flashy animation.
5. Show time via gradual densification, not spectacle.
6. Add subtle inertial movement so node masses feel alive but stable (no playful bounce).
7. Prioritize mass/density impression over geometric shape readability.
8. Inertial drift is visual-only and stable (seeded per node), never implying agency or randomness.

Exit criteria:
1. Visual identity feels stable, quiet, and technical.

### Phase 6 — Judge Flow Overlay (Optional)

1. WORLD tab overlay with max 4 steps:
   - Load scenario
   - Set FLOW to LIVE
   - Observe inertia and constraints
   - Open TRACE / EXPLAIN
2. Overlay is hideable.
3. Wording remains neutral and technical.

Exit criteria:
1. A new observer can understand the demo path in under 2 minutes.

## 6) Allowed Endpoint Surface for UI

1. Required:
   - `GET /world`
   - `GET /metrics`
   - `GET /logs`
   - `GET /explain/recent`
   - `POST /scenario/basic_auto`
   - `POST /auto/tick`
2. Optional (advanced read-only):
   - `GET /explain/agent/{id}`
   - `GET /agents/{id}`
3. Not exposed in UI controls:
   - `POST /act`
   - `POST /market/buy`

## 7) Definition of Done

UI is done when all are true:
1. FLOW modes are reliable.
2. World evolution is visible without repetitive user action.
3. Nodes read as state concentrations, not characters.
4. TRACE and EXPLAIN provide delayed clarity.
5. Forbidden wording does not appear in UI copy.
6. Judge can infer autonomy and constraints in ~2 minutes.

## 8) Execution Discipline

1. Implement in small, confirmable steps.
2. Stop for confirmation after each phase.
3. If concept and implementation conflict, concept wins.
4. If a change risks backend stability, do not proceed without explicit approval.
