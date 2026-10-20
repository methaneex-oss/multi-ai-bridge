"""Load agent definitions from agents/config.yaml"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "agents" / "config.yaml"


def load_agents(path: Path | None = None) -> List[Dict[str, Any]]:
    cfg_path = path or DEFAULT_CONFIG
    with open(cfg_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    agents = data.get("agents") or []
    if not agents:
        raise ValueError(f"No agents defined in {cfg_path}")
    return agents
