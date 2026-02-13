# UI Public Deploy Runbook (World Console)

This runbook covers public UI delivery without changing backend logic.

## Goal

Publish the UI so judges can open it from a browser and connect to the deployed API safely and reproducibly.

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

## Build & Verify

```bash
cd /Users/naturalmetalgear/Documents/world_model_agent/ui
source ~/.zshrc
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

1. Scene: `autonomy_proof`.
2. FLOW: run `LIVE` for 10+ cycles.
3. `Autonomy Evidence`: non-zero counts.
4. `EXPLAIN`: visible `DENIAL`, `COOLDOWN`, `ADAPTATION` tags.

## Rollback

If public UI fails:

1. Keep API on Fly unchanged.
2. Run UI locally (`npm run dev`) and continue demo from local browser.
3. Use existing API URL and key file import flow.

