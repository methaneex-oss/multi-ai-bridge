"""
Minimal Python client for the Multi-AI Bridge.
"""

from typing import Any, Dict, List, Optional
import requests


class BridgeClient:
    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if api_key:
            self.session.headers["X-API-Key"] = api_key

    def health(self) -> Dict[str, Any]:
        r = self.session.get(f"{self.base_url}/health")
        r.raise_for_status()
        return r.json()

    def get_state(self) -> Dict[str, Any]:
        r = self.session.get(f"{self.base_url}/api/v1/state")
        r.raise_for_status()
        return r.json()

    def set_task(
        self,
        title: str,
        description: str,
        goals: Optional[List[str]] = None,
        constraints: Optional[List[str]] = None,
        instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {
            "title": title,
            "description": description,
            "goals": goals or [],
            "constraints": constraints or [],
            "instructions": instructions or "",
        }
        r = self.session.post(f"{self.base_url}/api/v1/task", json=payload)
        r.raise_for_status()
        return r.json()

    def contribute(
        self,
        agent_name: str,
        role: str,
        content: str,
        contribution_type: str = "update",
        related_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload = {
            "agent_name": agent_name,
            "role": role,
            "content": content,
            "contribution_type": contribution_type,
            "related_to": related_to,
            "metadata": metadata or {},
        }
        r = self.session.post(f"{self.base_url}/api/v1/contribute", json=payload)
        r.raise_for_status()
        return r.json()

    def assign_role(self, agent_name: str, role: str) -> Dict[str, Any]:
        r = self.session.post(
            f"{self.base_url}/api/v1/role",
            json={"agent_name": agent_name, "role": role},
        )
        r.raise_for_status()
        return r.json()

    def get_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        r = self.session.get(f"{self.base_url}/api/v1/history", params={"limit": limit})
        r.raise_for_status()
        return r.json()

    def get_roles(self) -> Dict[str, str]:
        r = self.session.get(f"{self.base_url}/api/v1/roles")
        r.raise_for_status()
        return r.json()
