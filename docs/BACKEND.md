# Backend — complete working path

## 1. Deploy the API (required first)

Use the **root `Dockerfile`** (pure Go, no CGO).

### Render

1. New Web Service → connect `methaneex-oss/multi-ai-bridge`
2. Runtime: **Docker**
3. Dockerfile path: `./Dockerfile`
4. Health check: `/health`
5. Env:

```
BRIDGE_PORT=8080
DATABASE_PATH=/data/bridge.db
BRIDGE_API_KEY=choose-a-long-secret
```

6. Deploy → open `https://YOUR-SERVICE.onrender.com/health`

Expect: `{"status":"ok","service":"multi-ai-bridge"}`

### Local

```bash
docker build -t multi-ai-bridge .
docker run -p 8080:8080 -e BRIDGE_API_KEY=dev multi-ai-bridge
curl http://localhost:8080/health
```

---

## 2. Run real LLMs (not hardcoded)

On a machine that can reach the API:

```bash
git clone https://github.com/methaneex-oss/multi-ai-bridge.git
cd multi-ai-bridge
pip install -r runners/requirements.txt

export BRIDGE_URL=https://YOUR-SERVICE.onrender.com
export BRIDGE_API_KEY=your-secret
export OPENROUTER_API_KEY=sk-or-v1-...

python examples/set_task_with_rules.py
python -m runners.run_once
```

Agents are defined in `agents/config.yaml` (change models anytime).

---

## 3. UI later

Only after `/health` works, set on Vercel:

```
NEXT_PUBLIC_BRIDGE_URL=https://YOUR-SERVICE.onrender.com
NEXT_PUBLIC_WS_URL=wss://YOUR-SERVICE.onrender.com/ws
```

Root directory: `web`
