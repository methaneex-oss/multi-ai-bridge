#!/usr/bin/env python3
"""Create a project and upload a text artifact (e.g. spec or README content)."""

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

    project = client.create_project(
        name="JARVIS cognitive loop",
        description="Vertical slice for prediction-error-learning persistence",
    )
    print("Project:", project)

    art = client.add_artifact(
        project_id=project["id"],
        name="vertical_slice_spec.md",
        kind="spec",
        content=(
            "# Vertical slice\n\n"
            "1. Event + Journal + InternalState\n"
            "2. Minimal Prediction module\n"
            "3. Observation + prediction error\n"
            "4. Associative update\n"
            "5. Restart reconstruction test\n"
            "6. Behavioural test that learning changes the next prediction\n"
        ),
    )
    print("Artifact:", art["id"], art["name"])

    client.set_task(
        title="Implement the vertical slice",
        description="Follow the uploaded spec artifact.",
        instructions=(
            "Use the project artifacts as source of truth. "
            "Smallest working slice first. Record decisions in the bridge."
        ),
        project_id=project["id"],
        goals=["Working slice", "Replay test", "Learning influences next prediction"],
    )
    print("Task bound to project.")


if __name__ == "__main__":
    main()
