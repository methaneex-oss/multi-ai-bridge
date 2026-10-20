#!/usr/bin/env python3
"""
Set a task AND attach optional project instructions/rules.
Every agent runner will inject these rules into its system context.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "python"))

from client import BridgeClient

# Optional: extend the Python client on the fly if the server supports instructions
def set_task_with_instructions(client, title, description, goals=None, constraints=None, instructions=None):
    import requests
    payload = {
        "title": title,
        "description": description,
        "goals": goals or [],
        "constraints": constraints or [],
    }
    # instructions are stored by a compatible server field; we also keep them
    # in constraints/description if the core does not yet persist a dedicated field.
    if instructions:
        payload["description"] = description + "\n\n[PROJECT RULES]\n" + instructions
    r = client.session.post(f"{client.base_url}/api/v1/task", json=payload)
    r.raise_for_status()
    return r.json()


def main():
    client = BridgeClient(base_url=os.getenv("BRIDGE_URL", "http://localhost:8080"))

    rules = """
You are part of a disciplined multi-agent engineering team.
- Always read the shared bridge state before acting.
- Prefer the smallest vertical slice that proves the cognitive loop.
- No private mutable state outside the journal / shared state.
- Record important decisions and open questions in the bridge.
- Be concrete: prefer interfaces, tests, and measurable outcomes over vague plans.
""".strip()

    state = set_task_with_instructions(
        client,
        title="Build the core cognitive loop for JARVIS",
        description=(
            "Implement prediction → observation → error → learning → persistence → "
            "next prediction is influenced by prior learning. Full restart + reconstruction must work."
        ),
        goals=[
            "Working vertical slice",
            "Deterministic replay",
            "Tests proving learning changes future behaviour",
        ],
        constraints=[
            "No private mutable state outside the journal",
            "Modules communicate only through shared state + events",
        ],
        instructions=rules,
    )

    print("Task + rules set.")
    print("Status:", state.get("current_status"))


if __name__ == "__main__":
    main()
