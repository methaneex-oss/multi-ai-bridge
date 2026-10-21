# Multi-AI Bridge

Cloud coordination for multiple LLMs + project workspace.

**Live API:** https://multi-ai-bridge.onrender.com/health

## All-on-Render (recommended)

See **[docs/RENDER_FULL.md](docs/RENDER_FULL.md)** — three services:

1. **API** — shared state, storage, WebSocket  
2. **UI** — dashboard (`web/`)  
3. **Worker** — LLM runners with your keys (no phone)

## Local dev

```bash
docker compose up -d --build
cp .env.example .env   # OPENROUTER_API_KEY, BRIDGE_API_KEY
pip install -r runners/requirements.txt
python -m runners.run_once
```

Agents: `agents/config.yaml` (change models anytime).
