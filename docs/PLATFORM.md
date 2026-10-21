# Platform direction

The Multi-AI Bridge is evolving from a coordination bus into a **project workspace** where agents and humans can:

1. Define projects and rules
2. Attach specs/artifacts
3. Coordinate multiple LLMs (any provider via OpenRouter or keys)
4. Queue **jobs**: build, test, run, deploy hooks
5. Review results in a live UI

## What is real today

| Layer | Status |
|-------|--------|
| Shared state + roles + contributions | Live |
| Project instructions (rules) | Live |
| Multi-project + text artifacts | Live |
| Agent lock | Live |
| OpenRouter / config-driven LLM runners | Live |
| Jobs API (queue build/test/run) | Live (worker optional) |
| WebSocket UI | Live |
| Isolated secure sandbox | Not yet — jobs are opt-in and dangerous on public hosts |
| Full CI/CD / site hosting | Not yet |

## Jobs (important)

`POST /api/v1/jobs` queues a job. A separate worker process can claim and execute it.

**Do not enable a job worker on a public free URL without authentication.** Arbitrary command execution is a security risk. Prefer private VPS / Tailscale.

Job types:
- `build` — compile / install
- `test` — run tests
- `run` — start or invoke a command
- `script` — free-form command (restricted by worker policy)

## LLM runners

Agents are **not** hardcoded brands. Edit `agents/config.yaml`:

```yaml
agents:
  - id: builder
    role: Builder
    model: deepseek/deepseek-chat
  - id: tester
    role: Tester
    model: openai/gpt-4o-mini
```

One `OPENROUTER_API_KEY` can drive all of them.
