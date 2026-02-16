# Judge Evidence Pack (v5)

This folder contains visual and terminal evidence for the final demo freeze.

## Required screenshots

1. `world.png`
   - WORLD tab with loaded scenario and active graph.
2. `trace_explain.png`
   - TRACE or EXPLAIN tab with visible forensic events.
3. `judge.png`
   - JUDGE tab showing checks and readiness panel.

## Terminal evidence

`terminal_auth_replay.txt` stores the short terminal proof for:

- auth guard behavior: `401 -> 200`
- replay protection behavior: `200/201 -> 409`

Do not include secrets or full API keys in this folder.
