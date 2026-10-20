#!/usr/bin/env python3
"""Example: set the shared task that all AIs will work on."""

import sys
sys.path.insert(0, "../adapters/python")

from client import BridgeClient

client = BridgeClient(base_url="http://localhost:8080")

state = client.set_task(
    title="Build the core cognitive loop for JARVIS",
    description=(
        "Implement prediction → observation → error → learning → persistence → "
        "next prediction is influenced by prior learning. Full restart + reconstruction must work."
    ),
    goals=[
        "Working vertical slice",
        "Deterministic replay from journal",
        "Automated tests proving learning changes future behaviour",
    ],
    constraints=[
        "No private mutable state outside the journal",
        "All modules communicate only through shared state + events",
    ],
)

print("Task set.")
print("Status:", state.get("current_status"))
print("Version:", state.get("version"))
