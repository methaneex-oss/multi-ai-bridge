#!/usr/bin/env python3
"""Example: Claude posts an architecture plan."""

import sys
sys.path.insert(0, "../adapters/python")

from client import BridgeClient

client = BridgeClient(base_url="http://localhost:8080")

state = client.get_state()
print("Current task:", state.get("task_title"))

result = client.contribute(
    agent_name="Claude",
    role="Architect",
    contribution_type="plan",
    content=(
        "Architecture decision: treat JARVIS as a developmental cognitive substrate.\n"
        "Central object = Cognitive Cycle (Experience → Representation → Prediction & Appraisal\n"
        "→ Attention/Goals/Planning → Action → Prediction Error → Learning Update).\n"
        "All subsystems read/write a shared, versioned Internal State that survives restarts.\n"
        "First non-negotiable deliverable is the prediction-error-learning-persistence loop."
    ),
)

print("Contribution accepted:", result)
