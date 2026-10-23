# Project vs Task

## Project (long-lived)
- Name, description
- **Project rules** — standing constraints for every agent on this codebase/product
- **Knowledge / training data** — pasted specs, APIs, architecture notes, sample code, domain facts
- Stored as artifacts (`kind=knowledge`) on the server
- Survives many tasks

## Task (short-lived work unit)
- Title, description
- **Task rules / instructions** — for this unit of work only
- Bound to a `project_id` when set
- Agents always receive a **context pack**: project rules + knowledge + current task

## API
- `POST /api/v1/projects` `{ name, description, rules }`
- `POST /api/v1/knowledge` `{ project_id, name, content, kind? }`
- `POST /api/v1/artifacts` same shape (default kind `knowledge`)
- `GET /api/v1/context?project_id=` → `{ pack, project, knowledge, task }`
- `DELETE /api/v1/artifacts?id=` / `DELETE /api/v1/projects?id=`

## Agent runs
`POST /api/run-agents` loads `/api/v1/context` and injects `pack` into every agent system prompt so they are “trained” on project data, not only task rules.
