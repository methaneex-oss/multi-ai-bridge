# Multi-AI Bridge (Advanced)

**Private real-time coordination system for multiple AI agents.**

Polyglot bridge so Claude, Grok, GPT, Gemini, DeepSeek and any other agent can work on the **same task** in sync, with a live UI.

---

## Architecture

```
Web UI (Next.js)  ↔  Bridge Core (Go)  ↔  Agent Adapters (Python + TypeScript)
```

| Directory | Language | Role |
|-----------|----------|------|
| `bridge/` | Go | Event bus, shared state, WebSocket hub, REST API |
| `web/` | TypeScript (Next.js) | Live dashboard |
| `adapters/python/` | Python | Client for Python agents |
| `adapters/typescript/` | TypeScript | Client for JS/TS agents |
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

---

## Agent Protocol

1. `GET /api/v1/state` — read shared state  
2. Do the work for your role  
3. `POST /api/v1/contribute` — write result back  

Full contract in `docs/PROTOCOL.md`.

---

## Security

Run only on your private server. Use firewall, Tailscale, or reverse proxy. Optional API key supported.

Built for serious multi-AI collaboration.
