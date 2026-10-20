# Multi-AI Bridge (Advanced)

**Real-time coordination system for multiple AI agents.**

Any models (OpenRouter or direct keys) work on the same task with shared state, optional project rules, artifacts, and live UI.

**Repo:** https://github.com/methaneex-oss/multi-ai-bridge

---

## Quick start

```bash
git clone https://github.com/methaneex-oss/multi-ai-bridge.git
cd multi-ai-bridge
cp .env.example .env
# set OPENROUTER_API_KEY and optionally BRIDGE_API_KEY

docker compose up -d --build
pip install -r runners/requirements.txt

python examples/create_project_and_upload.py
python -m runners.run_once
```

- UI: http://localhost:3000  
- API: http://localhost:8080  
- WS: ws://localhost:8080/ws  

---

## What exists now

| Area | Status |
|------|--------|
| Go core + SQLite state | Yes |
| Project instructions/rules | Yes |
| WebSocket live push + CORS | Yes |
| Multi-project + artifacts | Yes |
| Agent turn lock | Yes |
| OpenRouter / multi-key runners | Yes |
| Config-driven agents (no hardcode) | Yes |
| Next.js dashboard | Yes (basic) |
| Runner Docker image | Yes |
| Conflict UI / multi-tenant auth | Not yet |
| Binary file uploads | Not yet (text artifacts only) |

Building continues — this is not a finished product.

See `docs/PROTOCOL.md`, `docs/AGENTS.md`, `docs/FREE_HOSTING.md`.
