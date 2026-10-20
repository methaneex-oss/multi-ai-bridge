#!/usr/bin/env python3
"""Example: Grok posts a contribution as Coder."""

import sys
sys.path.insert(0, "../adapters/python")

from client import BridgeClient

client = BridgeClient(base_url="http://localhost:8080")

# Always read state first
state = client.get_state()
print("Current task:", state.get("task_title"))
print("My role:", state.get("roles", {}).get("Grok", "(unassigned)"))

result = client.contribute(
    agent_name="Grok",
    role="Coder",
    contribution_type="code",
    content=(
        "Proposed first vertical slice:\n"
        "1. Event + Journal + InternalState skeleton\n"
        "2. Minimal Prediction module\n"
        "3. Observation ingestion + prediction-error calculation\n"
        "4. Simple associative model update\n"
        "5. Restart + reconstruction test\n"
        "6. Behavioural test proving next prediction is influenced by prior learning"
    ),
)

print("Contribution accepted:", result)
