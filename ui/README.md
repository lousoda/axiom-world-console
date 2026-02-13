# World Console UI (React + Vite)

UI observation layer for `world_model_agent`.

The backend is authoritative; this UI only visualizes state, flow, trace, and explainability.

## Local Development

```bash
cd ui
source ~/.zshrc
npm install
npm run dev
```

Open the URL printed by Vite (`http://localhost:5173` or next free port).

## Local Validation

```bash
cd ui
source ~/.zshrc
npm run test
npm run build
```

## Production Build

```bash
cd ui
source ~/.zshrc
npm run build
```

Artifacts are generated in `ui/dist/`.

## Public Deploy Patterns

### Recommended: Static UI + Reverse Proxy to API

If UI is hosted separately from Fly API, use same-origin proxy routing:

1. Configure host rewrite:
   - `/api/* -> https://world-model-agent-api.fly.dev/:splat`
2. In UI, set `API Endpoint` to `/api`

Why: avoids browser CORS issues without backend changes.

Example `Netlify _redirects`:

```text
/api/* https://world-model-agent-api.fly.dev/:splat 200
```

### Alternative: Same-Origin Hosting with API

Serve UI and API from one origin (for example via reverse proxy in front of Fly app).

### Not Recommended Near Deadline

Enabling broad backend CORS policy only for UI hosting flexibility.  
This changes API security surface and should be a separate decision.

## Demo Smoke Checklist (UI)

1. `Validate Link` returns status `200`.
2. `Load Scene` with `autonomy_proof`.
3. Run `LIVE` 10+ cycles.
4. `Autonomy Evidence` counters become `> 0`.
5. `EXPLAIN` shows tagged events:
   - `DENIAL`
   - `COOLDOWN`
   - `ADAPTATION`

