# Architecture map (evidence-based)

Inspected: `methaneex-oss/multi-ai-bridge` @ `main` (2026-10-23).

## What works (demonstrated live)

| Capability | Mechanism | Evidence |
|------------|-----------|----------|
| API health | Go `/health` on Render | HTTP 200 `status:ok` |
| Shared board task | SQLite `state` + `/api/v1/task` | GET/POST state |
| Contributions timeline | `/api/v1/contribute` + history | stores agent posts |
| Projects + rules | `/api/v1/projects` | create returns id + rules |
| Knowledge store | `/api/v1/knowledge` + artifacts | durable rows when JSON fields match |
| Context pack | `/api/v1/context` | pack string for agent prompts |
| Multi-LLM run | Netlify `run-agents` → OpenAI-compatible chat | sequential/parallel |
| UI flow | Netlify Setup→Project→Task→Agents→Run | page loads |
| Agent lock | `/api/v1/lock` | acquire/release |
| WebSocket hub | `/ws` | exists in Go |

## Partial / disconnected

| Item | Status |
|------|--------|
| `runners/` + `workers/job_worker.py` | Code present; not the primary Netlify run path |
| `jobs` API | Queue records; no guaranteed shell executor on Render free |
| Git branch coordination for agents | Not implemented |
| CI / automated tests | Absent |
| Durable disk across Render redeploys | Ephemeral — memory can wipe |
| `json_fix.go` types | Were unused until handlers wired to them |
| `home-client.tsx` | Leftover placeholder; `page.tsx` is the real UI |

## Highest-value gap addressed this cycle

**Broken integration:** project knowledge + standing decisions did not reliably enter agent context as structured engineering memory; no durable task objects beyond the single board task.

**Change:** `engineering_tasks` + `memory_entries` + context pack enrichment + fixed snake_case JSON for knowledge/artifacts/projects.

## Sources of truth

1. **Git repo** — committed implementation  
2. **Bridge SQLite** — runtime shared state, knowledge, tasks, memory  
3. **Agent contributions** — timeline of work products  

Conversation history is **not** durable project memory.

## Ordered next gaps

1. Optimistic concurrency on state (`version` check) for concurrent agent writes  
2. Wire engineering-task UI + memory write after successful/failed runs  
3. Smoke/integration script in CI  
4. Persistent volume or external DB for Render  
5. Git-aware agent edit protocol (branch, PR, conflict detect)  
