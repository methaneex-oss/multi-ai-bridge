# Multi-AI Bridge (Advanced)

**Private (or public-test) real-time coordination system for multiple AI agents.**

Polyglot bridge so any models (via OpenRouter or direct keys) can work on the **same task** in sync, with a live UI and optional project rules.

**Repo:** https://github.com/methaneex-oss/multi-ai-bridge

---

## Architecture

```
Web UI (Next.js + WebSocket)
        ↕
Bridge Core (Go) — shared state, roles, contributions, WS hub
        ↕
Agent runners (Python) — OpenRouter / any provider, config-driven
```

| Path | Role |
|------|------|
| `bridge/` | Go core: REST + WebSocket + SQLite |
| `web/` | Live dashboard |
| `adapters/` | Python + TypeScript clients |
| `agents/config.yaml` | Flexible agent definitions (no hardcoding) |
| `runners/` | Calls models and posts contributions |
| `examples/` | Task setup + demo scripts |
| `docs/` | Protocol, deployment, free hosting |

---

## Quick start

```bash
git clone https://github.com/methaneex-oss/multi-ai-bridge.git
cd multi-ai-bridge
cp .env.example .env
# edit .env → OPENROUTER_API_KEY=...  and optionally BRIDGE_API_KEY=...

docker compose up -d --build
```

- UI: http://localhost:3000  
- API: http://localhost:8080  
- WebSocket: ws://localhost:8080/ws  

```bash
pip install -r runners/requirements.txt
python examples/set_task_with_rules.py
python -m runners.run_once
```

---

## Design rules

- **No hardcoded AIs** — agents are role + model id in YAML  
- **OpenRouter-first** — one key can drive many models  
- **Optional project instructions** — injected into every agent run  
- **Keys stay in `.env`** — never in the shared state or git  

See `docs/AGENTS.md` and `docs/FREE_HOSTING.md`.

---

## Status (in progress — not finished)

- [x] Go core + persistent state + roles + history  
- [x] Project `instructions` field  
- [x] WebSocket live push + CORS  
- [x] Next.js dashboard (WS + timeline + rules)  
- [x] Python/TS adapters + flexible runners  
- [x] Example scripts  
- [ ] Multi-project / file upload workspace  
- [ ] Conflict resolution UI  
- [ ] Stronger auth / multi-tenant  
- [ ] Runner Docker service polished  

Building continues.
