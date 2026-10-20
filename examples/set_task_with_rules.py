#!/usr/bin/env python3
"""Set a task AND attach optional project instructions/rules."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "python"))

from client import BridgeClient


def main():
    client = BridgeClient(
        base_url=os.getenv("BRIDGE_URL", "http://localhost:8080"),
        api_key=os.getenv("BRIDGE_API_KEY") or None,
    )

    rules = """
You are part of a disciplined multi-agent engineering team.
- Always read the shared bridge state before acting.
- Prefer the smallest vertical slice that proves the cognitive loop.
- No private mutable state outside the journal / shared state.
- Record important decisions and open questions in the bridge.
- Be concrete: prefer interfaces, tests, and measurable outcomes over vague plans.
""".strip()

    state = client.set_task(
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
    print("Instructions stored:", bool(state.get("instructions")))


if __name__ == "__main__":
    main()
