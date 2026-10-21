#!/usr/bin/env python3
"""Run every configured agent once. Safe for cloud workers (no phone)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "adapters" / "python"))

from client import BridgeClient
from runners.config_loader import load_agents
from runners.llm import chat

DEFAULT_INSTRUCTIONS = """You are part of a multi-agent team on a shared bridge.
- Read shared state before acting.
- Prefer the smallest vertical slice that proves progress.
- Record decisions and open questions in the bridge.
- Be concrete: interfaces, tests, measurable outcomes.
""".strip()


def ensure_task(client: BridgeClient) -> dict:
    state = client.get_state()
    if state.get("task_title"):
        return state
    print("No task set — bootstrapping a default task on the server...")
    return client.set_task(
        title="Coordinate and advance the active project",
        description=(
            "Work as a multi-agent team. Inspect shared state, propose the next "
            "useful step, and post concrete contributions (plan, code, review, test)."
        ),
        instructions=DEFAULT_INSTRUCTIONS,
        goals=["Clear next step", "Documented decisions", "Testable progress"],
        constraints=["Use the shared bridge only", "No private unshared state"],
    )


def build_messages(agent: dict, state: dict, history: list, artifacts: list) -> list:
    role = agent.get("role", "Agent")
    instructions = state.get("instructions") or ""
    system_extra = agent.get("system_extra") or ""

    system_parts = [
        f"You are an AI agent with the role: {role}.",
        "You are part of a multi-agent team coordinating through a shared bridge.",
        "Always respect the shared state. Do not invent private state that is not recorded.",
    ]
    if instructions.strip():
        system_parts.append(
            "\n=== PROJECT INSTRUCTIONS / RULES (must follow) ===\n" + instructions.strip()
        )
    if system_extra.strip():
        system_parts.append("\n=== ROLE-SPECIFIC GUIDANCE ===\n" + system_extra.strip())

    hist_lines = []
    for h in (history or [])[:12]:
        hist_lines.append(
            f"- [{h.get('role')}/{h.get('agent_name')}] ({h.get('contribution_type')}): "
            f"{str(h.get('content', ''))[:500]}"
        )
    history_block = "\n".join(hist_lines) if hist_lines else "(no contributions yet)"

    art_lines = []
    for a in (artifacts or [])[:8]:
        art_lines.append(f"- {a.get('name')} ({a.get('kind')}): {str(a.get('content', ''))[:300]}")
    art_block = "\n".join(art_lines) if art_lines else "(none)"

    user_content = f"""Current shared task:
Title: {state.get('task_title') or '(none)'}
Description: {state.get('task_description') or ''}
Goals: {state.get('goals') or []}
Constraints: {state.get('constraints') or []}
Status: {state.get('current_status')}
Open questions: {state.get('open_questions') or []}
Decisions so far: {state.get('decisions') or []}

Project artifacts:
{art_block}

Recent contributions:
{history_block}

Your job as {role}: produce the next useful contribution for this team.
Respond with substantive content only. Do not wrap in JSON unless asked.
"""

    return [
        {"role": "system", "content": "\n".join(system_parts)},
        {"role": "user", "content": user_content},
    ]


def main() -> None:
    bridge_url = os.getenv("BRIDGE_URL", "http://localhost:8080").rstrip("/")
    api_key = os.getenv("BRIDGE_API_KEY") or None
    client = BridgeClient(base_url=bridge_url, api_key=api_key)

    try:
        health = client.health()
        print(f"Bridge OK: {health}")
    except Exception as e:
        print(f"Cannot reach bridge at {bridge_url}: {e}")
        sys.exit(1)

    state = ensure_task(client)
    history = client.get_history(limit=20)
    try:
        artifacts = client.list_artifacts(project_id=state.get("project_id") or None)
    except Exception:
        artifacts = []

    agents = load_agents()
    print(f"Task: {state.get('task_title')}")
    print(f"Running {len(agents)} agents...\n")

    for agent in agents:
        agent_id = agent.get("id", "agent")
        role = agent.get("role", "Agent")
        model = agent.get("model") or os.getenv("DEFAULT_MODEL", "anthropic/claude-sonnet-4")
        temperature = float(agent.get("temperature", 0.3))

        try:
            lock = client.acquire_lock(agent_id)
            if lock.get("status") == "busy":
                print(f"→ {agent_id} skipped (lock held by {lock.get('held_by')})")
                continue
        except Exception as e:
            print(f"→ {agent_id} lock error: {e}")

        print(f"→ {agent_id} ({role}) via {model}")
        messages = build_messages(agent, state, history, artifacts)

        try:
            content = chat(model=model, messages=messages, temperature=temperature)
        except Exception as e:
            print(f"  ERROR: {e}\n")
            try:
                client.release_lock(agent_id)
            except Exception:
                pass
            continue

        ctype = "update"
        role_l = role.lower()
        if "architect" in role_l:
            ctype = "plan"
        elif "coder" in role_l or "engineer" in role_l or "builder" in role_l:
            ctype = "code"
        elif "review" in role_l:
            ctype = "review"
        elif "test" in role_l:
            ctype = "test"

        try:
            result = client.contribute(
                agent_name=agent_id,
                role=role,
                content=content,
                contribution_type=ctype,
                metadata={"model": model},
            )
            print(f"  Posted {result.get('id')}\n")
        except Exception as e:
            print(f"  Post failed: {e}\n")
            try:
                client.release_lock(agent_id)
            except Exception:
                pass
            continue

        history = client.get_history(limit=20)
        state = client.get_state()

    print("Done.")


if __name__ == "__main__":
    main()
