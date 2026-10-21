# Host everything on Render (private-ish)

You keep **one obscure URL**. No need for Vercel if you prefer all-on-Render.

## Architecture on Render

```
[Browser] → multi-ai-bridge-ui  (Next.js)
                ↓ server proxy + API key
         multi-ai-bridge-api  (Go + SQLite + WebSocket)
                ↑
         (optional) runners worker  (OpenRouter keys live only here)
```

## Security (realistic)

- Unknown URL helps a little; it is **not** real security.
- Always set a long `BRIDGE_API_KEY` on the API and UI.
- Put **LLM keys only** on the runners worker (or run runners on your PC).
- Never commit keys to GitHub.

---

## Step A — API (you already have this)

Service type: **Web** · Docker · `./Dockerfile` · health `/health`

Env:

```
BRIDGE_PORT=8080
DATABASE_PATH=/data/bridge.db
BRIDGE_API_KEY=long-random-secret
```

Confirm: `https://YOUR-API.onrender.com/health`

---

## Step B — UI on Render (second Web service)

1. **New Web Service** → same repo `methaneex-oss/multi-ai-bridge`
2. **Name:** `multi-ai-bridge-ui`
3. **Dockerfile path:** `./web/Dockerfile`
4. **Docker context:** `./web`  (important)
5. **Instance:** Free

Env vars:

```
BRIDGE_URL=https://YOUR-API.onrender.com
BRIDGE_API_KEY=same-long-random-secret
NEXT_PUBLIC_WS_URL=wss://YOUR-API.onrender.com/ws
PORT=3000
```

Deploy. Open the **UI** URL (not the API URL).

You should see the dashboard. Create a project / set a task there.

---

## Step C — LLM keys (two options)

### Option 1 — Run agents on your PC (simplest, safest for keys)

```bash
export BRIDGE_URL=https://YOUR-API.onrender.com
export BRIDGE_API_KEY=same-secret
export OPENROUTER_API_KEY=sk-or-v1-...
# or OPENAI_API_KEY=...

python -m runners.run_once
```

Keys never sit on a public server.

### Option 2 — Background Worker on Render

1. **New Background Worker** → same repo
2. Dockerfile: `./runners/Dockerfile` · context `.`
3. Env:

```
BRIDGE_URL=https://YOUR-API.onrender.com
BRIDGE_API_KEY=same-secret
OPENROUTER_API_KEY=sk-or-v1-...
```

Free workers may spin down; paid is more reliable.

---

## Multiple LLM keys (all on runners only)

```
OPENROUTER_API_KEY=...     # preferred — many models, one key
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
XAI_API_KEY=...
```

Edit `agents/config.yaml` for which model each role uses.

---

## Checklist

- [ ] API `/health` = ok
- [ ] UI service env points at API URL + same `BRIDGE_API_KEY`
- [ ] Open UI URL → create project + task
- [ ] Run `runners.run_once` with OpenRouter (or worker)
- [ ] Contributions show on UI timeline
