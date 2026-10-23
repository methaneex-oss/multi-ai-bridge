# Git coordination (next phase design)

Status: **design only** — not implemented. Runtime memory and engineering tasks are separate from Git.

## Goals

Agents must not silently overwrite each other. Git remains the source of truth for code.

## Proposed protocol (future implementation)

1. **Branch ownership** — each engineering task gets `agent/<task-id>/<agent-id>` branch from current `main` SHA recorded on the task (`revision` field).
2. **Discover before edit** — agent must `GET` task + record `base_sha` before writing files.
3. **Small changesets** — one logical change per branch; no force-push.
4. **Conflict detection** — before merge, compare `base_sha` to current main; if diverged, mark task `blocked` with evidence, do not auto-merge.
5. **Test gate** — CI on the branch must pass before merge eligibility.
6. **Recoverable failures** — failed pushes recorded as `memory` kind=failure confidence=unverified with provenance.

## Explicit non-goals for v1 of this phase

- Automatic merge without human or policy gate
- Unrestricted write tokens for agents
- Force-push or history rewrite

## Relation to current system

- `engineering_tasks.revision` can store the base commit SHA once Git automation exists.
- `memory` already stores failure/success observations from runs.
- Export/import preserves task and memory across host wipes; it does not replace Git.
