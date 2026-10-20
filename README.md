# Multi-AI Bridge (Advanced)

**Private real-time coordination system for multiple AI agents.**

Polyglot bridge so Claude, Grok, GPT, Gemini, DeepSeek and any other agent can work on the **same task** in sync, with a live UI.

**Repo:** https://github.com/methaneex-oss/multi-ai-bridge

---

## Architecture

```
Web UI (Next.js)  ↔  Bridge Core (Go)  ↔  Agent Adapters (Python + TypeScript)
```

| Directory | Language | Role |
|-----------|----------|------|
| `bridge/` | Go | Shared state, roles, contributions, history, REST API |
| `web/` | TypeScript (Next.js) | Live dashboard + contribution timeline |
| `adapters/python/` | Python | Client for Python-based agents |
| `adapters/typescript/` | TypeScript | Client for JS/TS agents |
| `examples/` | Python | Ready-to-run scripts |
| `docs/` | Markdown | Protocol & deployment |

---

## Quick Start (Private Server)

```bash
git clone https://github.com/methaneex-oss/multi-ai-bridge.git
cd multi-ai-bridge
cp .env.example .env
docker compose up -d --build
```

- **UI**: http://localhost:3000  
- **API**: http://localhost:8080  

### First actions

```bash
# Set the shared task
python examples/set_task.py

# Assign roles
python examples/assign_roles.py

# Simulate agents contributing
python examples/contribute_as_claude.py
python examples/contribute_as_grok.py
```

Then open the UI to see the live state and timeline.

---

## Agent Protocol

1. `GET /api/v1/state` — read shared state  
2. Do the work for your role  
3. `POST /api/v1/contribute` — write result back  

Full contract in `docs/PROTOCOL.md`.

---

## Security

- Run only on your private server
- Optional `BRIDGE_API_KEY` (set in `.env`)
- Use firewall, Tailscale, or reverse proxy
- Never expose port 8080 publicly without authentication

---

## Status

- [x] Go core with persistent shared state
- [x] REST API (task, contribute, history, roles)
- [x] Next.js live dashboard + contribution timeline
- [x] Python + TypeScript adapters
- [x] Example scripts
- [ ] Full WebSocket push (next iteration)
- [ ] Auth hardening / multi-tenant (optional)

Built for serious multi-AI collaboration.
