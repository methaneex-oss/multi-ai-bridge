# Deploy on Render (free)

## Why the build failed

Render looks for a **Dockerfile at the repository root** by default.

This repo originally only had:

- `bridge/Dockerfile`
- `web/Dockerfile`
- `runners/Dockerfile`

A root `Dockerfile` is now included. It builds the **Go bridge API** (the core service).

---

## Fix / redeploy

1. Pull latest `main` (or reconnect the repo so Render sees the new root `Dockerfile`).
2. In Render service settings:
   - **Environment**: Docker
   - **Dockerfile Path**: `./Dockerfile` (or leave default)
   - **Docker Context**: `.`
3. Set environment variables:

| Key | Value |
|-----|--------|
| `BRIDGE_PORT` | `8080` |
| `DATABASE_PATH` | `/data/bridge.db` |
| `BRIDGE_API_KEY` | (optional secret) |
| `OPENROUTER_API_KEY` | (your key, for runners later) |

4. **Health check path**: `/health`
5. Redeploy.

After deploy, open:

```
https://YOUR-SERVICE.onrender.com/health
```

You should see `{"status":"ok","service":"multi-ai-bridge"}`.

---

## Notes

- Free tier **spins down** after idle time; first request can take ~30–60s.
- SQLite on free disk is fine for testing; data may reset if the instance is recycled unless you attach a persistent disk.
- The **Next.js UI** is a separate service. For a first deploy, run only the API. Point the UI later with `NEXT_PUBLIC_BRIDGE_URL=https://YOUR-SERVICE.onrender.com`.
- Always set `BRIDGE_API_KEY` if the URL is public.
