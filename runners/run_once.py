#!/usr/bin/env python3
"""
Run every configured agent once against the current bridge task.
Injects project instructions (rules) into each agent's context.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow running from repo root
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "adapters" / "python"))

from client import BridgeClient
from runners.config_loader import load_agents
from runners.llm import chat


def build_messages(agent: dict, state: dict, history: list) -> list:
    role = agent.get("role", "Agent")
    instructions = state.get("instructions") or state.get("project_instructions") or ""
    system_extra = agent.get("system_extra") or ""

    system_parts = [
        f"You are an AI agent with the role: {role}.",
        "You are part of a multi-agent team coordinating through a shared bridge.",
        "Always respect the shared state. Do not invent private state that is not recorded.",
    ]
    if instructions.strip():
        system_parts.append("\n=== PROJECT INSTRUCTIONS / RULES (must follow) ===\n" + instructions.strip())
    if system_extra.strip():
        system_parts.append("\n=== ROLE-SPECIFIC GUIDANCE ===\n" + system_extra.strip())

    system_content = "\n".join(system_parts)

    # Compact recent history
    hist_lines = []
    for h in (history or [])[:12]:
        hist_lines.append(
            f"- [{h.get('role')}/{h.get('agent_name')}] ({h.get('contribution_type')}): "
            f"{str(h.get('content', ''))[:500]}"
        )
    history_block = "\n".join(hist_lines) if hist_lines else "(no contributions yet)"

    user_content = f"""Current shared task:
Title: {state.get('task_title') or '(none)'}
Description: {state.get('task_description') or ''}
Goals: {state.get('goals') or []}
Constraints: {state.get('constraints') or []}
Status: {state.get('current_status')}
Open questions: {state.get('open_questions') or []}
Decisions so far: {state.get('decisions') or []}

Recent contributions:
{history_block}

Your job as {role}: produce the next useful contribution for this team.
Respond with substantive content only (plan, code, review, etc.). Do not wrap in JSON unless asked.
"""

    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]


def main() -> None:
    bridge_url = os.getenv("BRIDGE_URL", "http://localhost:8080")
    api_key = os.getenv("BRIDGE_API_KEY") or None
    client = BridgeClient(base_url=bridge_url, api_key=api_key)

    state = client.get_state()
    if not state.get("task_title"):
        print("No task set on the bridge. Run examples/set_task.py first (or POST /api/v1/task).")
        sys.exit(1)

    history = client.get_history(limit=20)
    agents = load_agents()

    print(f"Task: {state.get('task_title')}")
    print(f"Running {len(agents)} agents...\n")

    for agent in agents:
        agent_id = agent.get("id", "agent")
        role = agent.get("role", "Agent")
        model = agent.get("model") or os.getenv("DEFAULT_MODEL", "anthropic/claude-sonnet-4")
        temperature = float(agent.get("temperature", 0.3))

        print(f"→ {agent_id} ({role}) via {model}")
        messages = build_messages(agent, state, history)

        try:
            content = chat(model=model, messages=messages, temperature=temperature)
        except Exception as e:
            print(f"  ERROR: {e}\n")
            continue

        # Map role to a sensible contribution type
        ctype = "update"
        role_l = role.lower()
        if "architect" in role_l:
            ctype = "plan"
        elif "coder" in role_l or "engineer" in role_l:
            ctype = "code"
        elif "review" in role_l:
            ctype = "review"
        elif "test" in role_l:
            ctype = "test"
        elif "research" in role_l:
            ctype = "update"

        result = client.contribute(
            agent_name=agent_id,
            role=role,
            content=content,
            contribution_type=ctype,
            metadata={"model": model},
        )
        print(f"  Posted contribution {result.get('id')}\n")

        # Refresh history so later agents see earlier outputs in this same run
        history = client.get_history(limit=20)

    print("Done.")


if __name__ == "__main__":
    main()
