# Implementation inventory (handbook mapping)

Updated: 2026-10-24

## Status legend

designed · implemented · live verified · partial · not started

## Stage progress

| Stage | Status |
|-------|--------|
| 1 Reliable execution | partial — durable tasks/memory/export; free disk ephemeral |
| 2 Safe collaboration | **in progress** — transitions, version conflict, verification gate, agent lock |
| 3 Shared intelligence | partial — memory + context; no full staleness graph |
| 4 System-wide validation | **started** — independent verification records |
| 5–6 Adaptive / autonomy | not started |

## Capability map

| Handbook | Mechanism | Status |
|----------|-----------|--------|
| Task store + transitions §7.3 | engineering_tasks + taskTransitions | live verified |
| Implemented ≠ verified §7.3/§8 | verification_records; verified requires pass | implemented (redeploy) |
| Optimistic concurrency | expected_version on POST /task | live verified |
| Memory + provenance | memory_entries | live verified |
| Context package | /context enrichPack | live verified |
| Agent lock | /lock | live verified |
| Model adapters | OpenAI-compatible Netlify routes | live verified |
| UI engineering + verify | EngineeringPanel + expected_version | implemented |
| Git isolation / merge gates | GIT_COORDINATION.md | designed |
| Terminal isolation | jobs queue only | partial |
| Durable storage | export/import | partial |

## This cycle (bounded)

**Gap:** Handbook forbids marking work verified on implementer claim alone.

**Change:**
- `POST/GET /api/v1/verifications`
- PATCH status=verified rejected without result=pass verification
- UI panel to create tasks, advance status, record pass/fail
- Board task POST sends expected_version

## Still not in line (honest backlog)

1. Git worktrees / conflict detection / integration gates
2. True durable DB (not free Render ephemeral disk)
3. Memory staleness / supersedes graph
4. Structured execution service with risk classes
5. Permission matrix beyond optional API key
6. Automated end-to-end handbook scenarios (parallel agents, stale context, etc.)

## Next action

Live-verify verifications API after Render redeploy, then Git coordination slice.
