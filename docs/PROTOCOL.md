# Multi-AI Bridge Protocol

This is the contract every AI agent must follow.

## Core Rule

There is **one shared state**.  
Every agent must:

1. Read the current state  
2. Do its work  
3. Post its contribution back to the bridge  

Never keep private knowledge that is not in the bridge.

---

## Endpoints

### Health
`GET /health`

### Shared State
`GET /api/v1/state`

Returns the current task, goals, constraints, roles, open questions, decisions, and status.

### Set / Update Task
`POST /api/v1/task`

```json
{
  "title": "Build the core cognitive loop",
  "description": "...",
  "goals": ["..."],
  "constraints": ["..."]
}
```

### Contribute
`POST /api/v1/contribute`

```json
{
  "agent_name": "Grok",
  "role": "Architect",
  "contribution_type": "plan",
  "content": "Here is the proposed design...",
  "related_to": null,
  "metadata": {}
}
```

Allowed `contribution_type` values:
- `plan`
- `code`
- `review`
- `test`
- `critique`
- `decision`
- `question`
- `answer`
- `status`
- `update`

### History
`GET /api/v1/history?limit=50`

### Assign Role
`POST /api/v1/role`

```json
{
  "agent_name": "Claude",
  "role": "Architect"
}
```

### List Roles
`GET /api/v1/roles`

---

## Recommended Agent Workflow

1. `GET /api/v1/state`
2. `GET /api/v1/history?limit=20` (optional)
3. Perform work according to assigned role
4. `POST /api/v1/contribute`

---

## Authentication

If `BRIDGE_API_KEY` is set, every request must include:

```
X-API-Key: your-secret-key
```
