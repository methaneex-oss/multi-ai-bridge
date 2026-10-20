# Agent Runners & Project Rules

This layer makes the bridge *actually drive* models. It is deliberately **not** hardcoded to Claude / GPT / Gemini / etc.

## Design principles

1. **Provider-agnostic** — prefer OpenRouter (one key → many models). Direct keys are optional fallbacks.
2. **No hard-coded AIs** — agents are defined by *role + model preference*, not by brand name.
3. **Project instructions / rules** — when a task is started you can attach optional rules. Every agent receives them as system context.
4. **You control the keys** — put keys only in `.env` on your private server. The bridge never stores them in the shared state.

---

## Project instructions (rules)

When you create or update a task you can pass `instructions`:

```json
{
  "title": "Build the cognitive loop",
  "description": "...",
  "goals": ["..."],
  "constraints": ["..."],
  "instructions": "You are part of a multi-agent team. Always read the shared state first. Follow the vertical-slice discipline. Never invent private mutable state. Cite decisions in the bridge."
}
```

These instructions are stored in the shared state and injected into every agent run as high-priority system context.

---

## Defining agents (no hardcoding)

Agents live in `agents/config.yaml` (or are passed at runtime):

```yaml
agents:
  - id: architect
    role: Architect
    model: anthropic/claude-sonnet-4   # OpenRouter model id
    temperature: 0.3

  - id: coder
    role: Coder
    model: deepseek/deepseek-chat
    temperature: 0.2

  - id: reviewer
    role: Reviewer
    model: openai/gpt-4o
    temperature: 0.2

  - id: researcher
    role: Researcher
    model: google/gemini-2.0-flash
    temperature: 0.4
```

You can add, remove, or change models at any time. One OpenRouter key is enough for all of them.

---

## Running agents

```bash
# One-shot: run every configured agent once against the current task
python -m runners.run_once

# Continuous loop (poll bridge, run agents that have work)
python -m runners.run_loop --interval 60
```

Each run:
1. Reads shared state (including project instructions)
2. Builds a prompt that includes role + instructions + recent history
3. Calls the chosen model via OpenRouter (or direct provider)
4. Posts the model output back as a contribution

---

## OpenRouter vs direct keys

| Situation | What to put in `.env` |
|-----------|------------------------|
| You have an OpenRouter key | `OPENROUTER_API_KEY=...` only |
| You only have an OpenAI key | `OPENAI_API_KEY=...` and set models to `openai/...` or use the OpenAI-compatible path |
| Mix of keys | Set any combination; the runner picks the right base URL |

The runner never assumes a fixed list of brands.
