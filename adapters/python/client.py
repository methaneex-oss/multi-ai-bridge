"""Python client for the Multi-AI Bridge."""

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
        project_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {
            "title": title,
            "description": description,
            "goals": goals or [],
            "constraints": constraints or [],
            "instructions": instructions or "",
            "project_id": project_id or "",
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

    def create_project(self, name: str, description: str = "") -> Dict[str, Any]:
        r = self.session.post(
            f"{self.base_url}/api/v1/projects",
            json={"name": name, "description": description},
        )
        r.raise_for_status()
        return r.json()

    def list_projects(self) -> List[Dict[str, Any]]:
        r = self.session.get(f"{self.base_url}/api/v1/projects")
        r.raise_for_status()
        return r.json()

    def add_artifact(
        self,
        name: str,
        content: str,
        kind: str = "note",
        project_id: str = "",
    ) -> Dict[str, Any]:
        r = self.session.post(
            f"{self.base_url}/api/v1/artifacts",
            json={"name": name, "content": content, "kind": kind, "project_id": project_id},
        )
        r.raise_for_status()
        return r.json()

    def list_artifacts(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        params = {"project_id": project_id} if project_id else {}
        r = self.session.get(f"{self.base_url}/api/v1/artifacts", params=params)
        r.raise_for_status()
        return r.json()

    def acquire_lock(self, agent_name: str) -> Dict[str, Any]:
        r = self.session.post(
            f"{self.base_url}/api/v1/lock",
            json={"agent_name": agent_name, "action": "acquire"},
        )
        if r.status_code == 409:
            return r.json()
        r.raise_for_status()
        return r.json()

    def release_lock(self, agent_name: str) -> Dict[str, Any]:
        r = self.session.post(
            f"{self.base_url}/api/v1/lock",
            json={"agent_name": agent_name, "action": "release"},
        )
        r.raise_for_status()
        return r.json()
