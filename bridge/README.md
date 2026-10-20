# Bridge Core (Go)

High-performance shared state + event bus + WebSocket hub.

This directory will contain the Go service that all agents and the UI talk to.

Planned layout:

```
bridge/
  main.go
  go.mod
  Dockerfile
  internal/
    api/
    store/
    ws/
    models/
```

Status: foundation committed. Core implementation coming next.
