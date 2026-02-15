# UI Product Plan (World Console Narrative)

This file defines the conceptual narrative and product identity for the UI layer.
Implementation details are tracked in `docs/UI_EXECUTION_CHECKLIST.md`.
Status: planning artifact; not every item here is implemented yet.

## 1) Product Intent

The UI is a world observation interface for a deterministic system.
It must demonstrate:

1. autonomy under constraints,
2. delayed explainability through traces,
3. confidence in stable, rule-bound evolution.

The UI is not a game interface and not a manual control board.

## 2) Narrative Pillars

1. Stability as strength, not stagnation.
2. Autonomy as persistence under rules.
3. Explainability as forensic reconstruction after events.
4. Time as an active force in world evolution.

## 3) Observer Role

The user is an observer, not a puppeteer.
The world evolves primarily through system flow, not direct user micromanagement.

Allowed observer interactions:
1. load scenario,
2. modulate FLOW (`LIVE`, `PAUSE`, `ACCELERATE`).

## 4) Visual Philosophy

1. Graph should read as state-field, not cast of characters.
2. State Nodes should feel dense, accumulated, and non-uniform.
3. Influence Edges are secondary; they hint at flow, not explicit narrative.
4. Motion should be restrained and meaningful.
5. Visual direction is dark, forensic graph-console oriented, with strong contrast between calm background and dense node masses.
6. Node bodies should feel volumetric and physically weighted, not flat icons.

## 4.3) Dreamcore Optics (Observer Channel Only)

Dreamcore here is a restrained optics layer, not a genre shift.
The system remains deterministic; only the observer channel is softened.

Intent:

1. quiet tension,
2. delayed clarity,
3. stable trust under imperfect perception.

Allowed optics (low intensity, optional):

1. fine monochrome grain,
2. soft vignette framing,
3. wide soft bloom (non-neon),
4. very low chromatic aberration near viewport edges.

Rules:

1. readability always wins,
2. effects must be felt before noticed,
3. optics must never suggest randomness in system behavior,
4. no playful/game-like treatment.

## 4.4) State-Mass Visual References (Interpretation)

From reference boards, preserve pattern-level cues only:

1. dense central concentration + sparse peripheral ring,
2. micro-point internal structure (not flat fills),
3. multi-cluster field impression with secondary links,
4. muted dark background with restrained contrast.

Do not copy exact composition, palette identity, or branded look.

## 4.1) State-Field Node Model (Visual + Semantic)

1. Nodes are localized state concentrations, not entities.
2. Each node must appear memory-bearing and inertial.
3. Node surfaces should show internal density structure, not a single-color fill.
4. Time should be perceived as gradual densification/weight shift, not as explicit timeline UI.
5. Node motion should be subtle and continuous (drift), avoiding jitter and spectacle.
6. If any visual choice makes nodes read like characters, reduce semantic detail and increase abstraction.

### 4.2) Abstraction Safety Micro-Checklist

If nodes start to read as characters, apply these corrections:

1. Reduce labels and remove icon-like markers.
2. Remove face-like symmetry and soften center contrast.
3. De-emphasize edges further so node mass remains primary.

## 5) Language Philosophy

1. Tone: technical, forensic, concise.
2. Avoid anthropomorphism.
3. Avoid lore-heavy text and marketing voice.
4. Use precise status communication and restrained copy.

## 6) Canonical Labels

1. Product label: `World Console`
2. Tabs:
   - `WORLD`
   - `TRACE`
   - `EXPLAIN`
   - `JUDGE` (optional)
   - `HOW IT WORKS` (optional)
3. Trace labels:
   - `Deferred Trace`
   - `Explainability Trace`

## 6.1) Console Artifact (Optional)

The UI may include one soft console artifact (marker/seal/cue) with these limits:

1. belongs to console, not to world simulation,
2. no causal meaning,
3. no interaction requirements,
4. low prominence.

## 7) UX Outcome (Judge-Oriented)

Within ~2 minutes, a judge should be able to infer:
1. the system keeps evolving without manual command chains,
2. constraints are real and visible,
3. traces explain what happened after the fact.

## 8) Scope Boundaries

1. Backend behavior is frozen.
2. No backend feature expansion for UI polish.
3. Optional integrations (`x402`, extra scenario, contract spike) are separate post-UI decisions.

## 9) Anti-Copy Guardrail

Reuse only pattern-level strengths:
1. clarity of flow,
2. observability density,
3. concise judge path.

Do not copy external identity:
1. no borrowed wording,
2. no borrowed composition,
3. no borrowed visual language.

## 10) Decision Gate Before Optional Work

Proceed to optional work only if all are true:
1. UI execution checklist is complete.
2. Backend and ops gates remain green.
3. Submission materials are ready.
