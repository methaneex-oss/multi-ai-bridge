# Everything on Render (no phone)

API URL (yours): **https://multi-ai-bridge.onrender.com**

Check: https://multi-ai-bridge.onrender.com/health

---

## Three services (same GitHub repo)

### 1) API — already live

- Web service, Docker `./Dockerfile`
- Env: `BRIDGE_PORT=8080`, `DATABASE_PATH=/data/bridge.db`, `BRIDGE_API_KEY=...`

### 2) UI — create this next

**New Web Service**

| Setting | Value |
|---------|--------|
| Name | `multi-ai-bridge-ui` |
| Dockerfile path | `./web/Dockerfile` |
| Docker context | `./web` |
| Plan | Free |

Env:

```
BRIDGE_URL=https://multi-ai-bridge.onrender.com
BRIDGE_API_KEY=<same as API>
NEXT_PUBLIC_WS_URL=wss://multi-ai-bridge.onrender.com/ws
PORT=3000
```

Open the **UI** service URL (different from the API URL).

### 3) LLM worker — agents on the server

**New Background Worker**

| Setting | Value |
|---------|--------|
| Name | `multi-ai-bridge-runners` |
| Dockerfile path | `./runners/Dockerfile` |
| Docker context | `.` (repo root) |

Env:

```
BRIDGE_URL=https://multi-ai-bridge.onrender.com
BRIDGE_API_KEY=<same as API>
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional extras: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `DEFAULT_MODEL`.

The worker loops every ~2 minutes, calls models, posts contributions. **No phone process.**

---

## Flow

1. API stores state + SQLite  
2. UI (browser) reads/writes via proxy  
3. Worker calls OpenRouter / other keys and posts results  

You only open the **UI URL** in a browser when you want to watch.

---

## Notes

- Free services sleep when idle; first request can take 30–60s.
- Set a strong `BRIDGE_API_KEY`.
- LLM keys only on the **worker**, never in the public UI.
- Persistent disk on the API service if you need storage to survive free-tier recycles.
