# How to access the bridge (one URL)

You do **not** need to open Render directly for normal use.

## Primary entry (Netlify — what you use)

**UI + API proxy:** https://multi-ai-bridge-ui.netlify.app

| What you need | Where |
|---------------|--------|
| Dashboard | `https://multi-ai-bridge-ui.netlify.app/` |
| Health (via proxy) | `https://multi-ai-bridge-ui.netlify.app/api/bridge/health` |
| State | `.../api/bridge/api/v1/state` |
| Tasks / memory / context | same prefix `.../api/bridge/api/v1/...` |
| Run agents | UI **Run** step (server route on Netlify) |

All browser traffic stays on the Netlify origin. Server routes on Netlify call the Go API.

## Backend host (Render — infrastructure only)

**API process:** https://multi-ai-bridge.onrender.com  
Free tier may sleep; the Netlify proxy retries 502/503/504.

Env on Netlify site `multi-ai-bridge-ui` (managed via Netlify connector):

- `BRIDGE_URL=https://multi-ai-bridge.onrender.com`
- `NEXT_PUBLIC_WS_URL=wss://multi-ai-bridge.onrender.com/ws`

## Verified (2026-10-23)

- Netlify UI → proxy → Render health: OK  
- Create project, engineering task, memory, context pack enrichment: OK through Netlify origin only  

## Why two hosts still exist

- **Netlify** runs the Next.js UI and serverless routes (LLM keys, proxy).  
- **Render** runs the long-lived Go process + SQLite.  
Netlify cannot host the current Go binary as a persistent process on free tier.

For you: bookmark **only** the Netlify URL.
