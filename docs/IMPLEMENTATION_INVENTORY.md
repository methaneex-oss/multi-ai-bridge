# Implementation inventory (handbook mapping)

Inspected: `methaneex-oss/multi-ai-bridge` @ main · 2026-10-23
Guide: Advanced Multi-Agent Engineering Platform Handbook v1.0

Status labels: **designed** | **implemented** | **locally tested** | **live verified** | **not started**

## Handbook stage alignment

| Stage | Focus | Platform status |
|-------|--------|-----------------|
| 1 Reliable execution | Durable task state, agent lifecycle, recovery | Partial — board state + engineering_tasks + export/import; disk on Render free is best-effort |
| 2 Safe collaboration | Ownership, conflict, integration | **In progress** — agent lock, task transitions, optimistic version; Git integration not started |
| 3 Shared intelligence | Memory, provenance, version-aware context | Partial — memory_entries + context enrich; no staleness/supersession graph |
| 4–6 | System validation, adaptive, autonomy | Not started as platform capabilities |

## Capability map

| Handbook concern | Mechanism | Status |
|------------------|-----------|--------|
| Orchestrator / shared board | Go `/api/v1/state`, `/task`, WS | live verified |
| Engineering tasks | `engineering_tasks` + transitions | implemented (redeploy for live verify) |
| Task status machine §7.3 | `taskTransitions` reject invalid PATCH | implemented |
| Optimistic concurrency | `expected_version` on POST `/task` → 409 | implemented |
| Agent lock | `/api/v1/lock` | live verified |
| Memory + provenance | `memory_entries` confidence/provenance | live verified |
| Context builder | `/api/v1/context` enrichPack | live verified |
| Model adapter | OpenAI-compatible via Netlify run-agents | live verified (with provider keys) |
| Export/import recovery | `/api/v1/export`, `/import` | live verified export |
| Git / worktrees / merge gates | docs/GIT_COORDINATION.md only | designed |
| Terminal execution isolation | jobs table; no trusted executor on free Render | partial |
| Verification records | evidence field on tasks; no verification table | partial |
| Permission / audit layer | optional BRIDGE_API_KEY | partial |
| CI regression | `.github/workflows/ci.yml` + coord_test.go | implemented (CI run not asserted here) |

## Highest-impact gap closed this cycle

Concurrent agents could overwrite board state and jump task status without rules.

**Change:** formal task transitions + optional `expected_version` conflict on task updates.

## Next highest-priority gap

1. Live-verify transitions and version conflict after Render redeploy.
2. UI: show engineering-task status and send `expected_version` from state.
3. Git coordination (isolated branches, conflict detect) per GIT_COORDINATION.md.
4. Durable storage beyond free-tier ephemeral disk.

## Authority of state (handbook §2.2)

| Kind | Authority |
|------|-----------|
| Code | Git |
| Operational tasks | SQLite `engineering_tasks` |
| Board snapshot | SQLite `state` |
| Experience | SQLite `memory_entries` (does not override current state) |
| Agent outputs | `contributions` timeline |
