# Persistence reality (Render free)

## Observed

- `DATABASE_PATH=/data/bridge.db` is set.
- Root Dockerfile creates `/data`.
- **Render free web services do not provide a durable disk by default.**
- A process restart *within* the same instance may keep `/data`; a **redeploy or scale-to-zero wake** can wipe the filesystem.

Therefore: SQLite on free Render is **best-effort**, not guaranteed durable storage.

## Mitigation in this repo

1. **`GET /api/v1/export`** — JSON snapshot of state, projects, artifacts, engineering tasks, memory.
2. **`POST /api/v1/import`** — merge snapshot (INSERT OR REPLACE by id; does not delete extra rows).
3. Smoke tests and CI run against an ephemeral SQLite DB to verify logic independent of host disk.

## Recommended production path (not forced)

- Attach a **Render disk** (paid) at `/data`, or
- Point `DATABASE_PATH` at a network volume, or
- Use an external DB (Postgres/Turso) in a later migration.

Until then: export after important sessions; import after redeploy.

## Git vs runtime memory

| Store | Role |
|-------|------|
| Git | Source of truth for code |
| SQLite / snapshot | Runtime coordination memory |
| Contributions | Timeline of agent outputs |
