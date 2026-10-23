Routes added in coord.go handlers:
- GET/POST/PATCH /api/v1/engineering-tasks
- GET/POST /api/v1/memory

main.go must call migrateCoord(db) and register:
  mux.HandleFunc("/api/v1/engineering-tasks", withCORS(s.auth(s.handleEngineeringTasks)))
  mux.HandleFunc("/api/v1/memory", withCORS(s.auth(s.handleMemory)))

If deploy fails to compile, ensure bridge/coord.go is present (same package main).
