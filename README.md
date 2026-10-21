# Multi-AI Bridge

Coordination + project workspace for multiple LLMs (any provider via OpenRouter or keys).

**Repo:** https://github.com/methaneex-oss/multi-ai-bridge

## Features (in progress)

- Shared state, roles, contributions, WebSocket UI
- Project rules/instructions injected into every agent
- Multi-project + text artifacts
- Config-driven agents (no hardcoded brands) + OpenRouter
- Jobs API: queue build / test / run commands
- Optional local job worker (allowlisted commands)
- Agent turn lock

## Quick start

```bash
cp .env.example .env   # set OPENROUTER_API_KEY, BRIDGE_API_KEY
docker compose up -d --build
pip install -r runners/requirements.txt
python examples/create_project_and_upload.py
python -m runners.run_once
# optional private worker:
python workers/job_worker.py
```

Render: use root `Dockerfile` (see `docs/RENDER.md`).

## Security

Do **not** run the job worker on a public free URL without a strong `BRIDGE_API_KEY` and allowlist. Prefer private VPS.

See `docs/PLATFORM.md`, `docs/PROTOCOL.md`, `docs/AGENTS.md`.
