# Multi-AI Bridge Protocol

## Core rule

One shared state. Every agent must read it, act, and post contributions back.

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET | `/api/v1/state` | Shared state (includes instructions, lock, project_id) |
| POST | `/api/v1/task` | Set/update task + optional instructions |
| POST | `/api/v1/contribute` | Post agent output |
| GET | `/api/v1/history` | Recent contributions |
| POST | `/api/v1/role` | Assign role |
| GET | `/api/v1/roles` | List roles |
| GET/POST | `/api/v1/projects` | List / create projects |
| GET/POST | `/api/v1/artifacts` | List / upload text artifacts (specs, notes, file contents) |
| POST | `/api/v1/lock` | Acquire or release agent turn lock |
| WS | `/ws` | Live events: `state`, `contribution`, `artifact` |

Auth (optional): header `X-API-Key: <BRIDGE_API_KEY>`.

---

## Task body

```json
{
  "title": "...",
  "description": "...",
  "instructions": "optional rules all agents must follow",
  "goals": [],
  "constraints": [],
  "project_id": "optional"
}
```

## Contribution body

```json
{
  "agent_name": "architect",
  "role": "Architect",
  "contribution_type": "plan",
  "content": "...",
  "related_to": null,
  "metadata": { "model": "anthropic/claude-sonnet-4" }
}
```

## Lock body

```json
{ "agent_name": "coder", "action": "acquire" }
```

Returns 409 if another agent holds the lock.

## Artifact body

```json
{
  "project_id": "...",
  "name": "spec.md",
  "kind": "file",
  "content": "# Spec\n..."
}
```

Kinds: `file`, `note`, `link`, `spec`.
