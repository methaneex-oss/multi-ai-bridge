# Deploying on Vercel

## What belongs on Vercel

| Piece | Vercel? | Why |
|-------|---------|-----|
| **Next.js UI** (`web/`) | Yes | Perfect fit — preview deploys, domains, env vars |
| **Go bridge API** | No (not as-is) | Needs long-running process, WebSockets, SQLite disk |
| **Job worker** | No | Runs shell commands; needs a private VM |

**Recommended split**

1. **UI** → Vercel (this doc)
2. **API** → Render / Railway / Fly / private VPS (root `Dockerfile`)
3. Point UI at API with `NEXT_PUBLIC_BRIDGE_URL` and `NEXT_PUBLIC_WS_URL`

---

## One-time setup

### 1. Grant Vercel access to the GitHub repo

Vercel must be allowed to read `methaneex-oss/multi-ai-bridge`:

1. Open [Vercel Dashboard](https://vercel.com/dashboard) → **Settings** → **Git**
2. Or when importing: authorize the **Vercel GitHub App** for the `methaneex-oss` account / that repo
3. Confirm the app has **Contents: Read** on the repo

### 2. Import / link project

- Project name: `multi-ai-bridge-ui` (already created)
- **Root Directory:** `web`
- **Framework:** Next.js

### 3. Environment variables (Production + Preview)

| Name | Example |
|------|---------|
| `NEXT_PUBLIC_BRIDGE_URL` | `https://YOUR-API.onrender.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://YOUR-API.onrender.com/ws` |

No API keys in the browser. Keys stay on the API host only.

### 4. Deploy

Every push to `main` that changes `web/` can auto-deploy once Git is linked.

---

## Security

- Use `BRIDGE_API_KEY` on the API host
- Prefer private API + Vercel UI, or protect both
- Do not run job workers on public serverless platforms
