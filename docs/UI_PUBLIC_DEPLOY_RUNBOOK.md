# UI Public Deploy Runbook

This runbook covers public UI delivery without changing backend logic.

## Goal

Publish the UI so judges can open it from a browser and connect to the deployed API safely and reproducibly, then complete the autonomy and determinism narrative in ~2 minutes.

## Current Constraints

1. Backend API runs on Fly (`https://world-model-agent-api.fly.dev`).
2. UI is a separate Vite app (`ui/`).
3. Browser CORS can block direct cross-origin API calls from static UI.

## Recommended Production Topology

Use static UI hosting with same-origin reverse proxy:

1. Host UI static files (`ui/dist`) on Netlify/Vercel/Cloudflare Pages.
2. Add rewrite so `/api/*` forwards to Fly API.
3. In UI, set `API Endpoint` to `/api`.

This keeps browser requests same-origin from UI perspective.

## Build and Verify

```bash
cd ui
npm install
npm run test
npm run build
```

Expected:

1. `vitest` passes.
2. Build outputs `ui/dist`.

## Host Configuration Example (Netlify)

Create `ui/public/_redirects` (or host-level redirects):

```text
/api/* https://world-model-agent-api.fly.dev/:splat 200
```

After deploy:

1. Open UI URL.
2. Set `API Endpoint` to `/api`.
3. Paste valid `X-World-Gate`.
4. `Validate Link` should return `200`.

## Judge Demo Minimum Check

1. Scenario: `autonomy_proof` (or `basic_auto` if `autonomy_proof` is unavailable).
2. FLOW: run `LIVE` for 10+ cycles.
3. `Autonomy Evidence`: non-zero counters.
4. `EXPLAIN`: visible `DENIAL`, `COOLDOWN`, or `ADAPTATION` tags.

## Versioning / Cache Busting
- Use hashed asset filenames from Vite; avoid shipping unversioned `index.js`/`index.css`.
- After deploy, purge CDN/edge cache; include `?v=<git-sha>` on fallback links if needed.

## Health Check and Rollback
1. Post-deploy: `curl -I <ui-url>` and `curl -I <ui-url>/api/world` (expect `200`).
2. If UI returns 5xx/blank, redeploy last known good build (keep artifact) or pivot judges to local UI (`npm run dev`) pointing at the same API; keep API on Fly unchanged.

## Endpoint Provenance
- Default assumed API: `https://world-model-agent-api.fly.dev` (last validated 2026-02-14). Update this note when the API host changes.
