#!/usr/bin/env python3
"""Example: assign roles to different AI agents."""

import sys
sys.path.insert(0, "../adapters/python")

from client import BridgeClient

client = BridgeClient(base_url="http://localhost:8080")

roles = {
    "Claude": "Architect",
    "Grok": "Coder",
    "ChatGPT": "Reviewer",
    "Gemini": "Researcher",
    "DeepSeek": "Tester",
}

for agent, role in roles.items():
    client.assign_role(agent, role)
    print(f"Assigned {agent} → {role}")

print("\nCurrent roles:")
print(client.get_roles())
