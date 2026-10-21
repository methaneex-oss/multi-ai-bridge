#!/usr/bin/env python3
"""
Optional job worker: claims queued jobs and runs commands locally.

SECURITY: Do NOT run this on a public host without BRIDGE_API_KEY and a tight allowlist.
Prefer private VPS / Tailscale.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "python"))

from client import BridgeClient  # noqa: E402

# Very small allowlist prefixes — extend carefully
ALLOW_PREFIXES = (
    "npm ",
    "npx ",
    "yarn ",
    "pnpm ",
    "python ",
    "python3 ",
    "pytest",
    "go test",
    "go build",
    "cargo test",
    "cargo build",
    "make ",
    "echo ",
)


def allowed(cmd: str) -> bool:
    c = cmd.strip()
    return any(c.startswith(p) for p in ALLOW_PREFIXES)


def claim_and_run(client: BridgeClient, base_url: str, api_key: str | None) -> bool:
    """Poll jobs; if queued and allowed, mark running via contribute + local exec.

    The core API currently queues jobs; status updates are posted as contributions
    and by re-insert pattern. For a minimal worker we execute and report output
    as a contribution + optional artifact.
    """
    session = requests.Session()
    if api_key:
        session.headers["X-API-Key"] = api_key
    r = session.get(f"{base_url}/api/v1/jobs")
    r.raise_for_status()
    jobs = r.json() or []
    queued = [j for j in jobs if j.get("status") == "queued"]
    if not queued:
        return False

    job = queued[-1]  # oldest-ish from DESC list — take last
    cmd = job.get("command") or ""
    jid = job.get("id")
    print(f"Job {jid}: {cmd}")

    if not allowed(cmd):
        client.contribute(
            agent_name="job-worker",
            role="Worker",
            contribution_type="status",
            content=f"Job {jid} rejected: command not in allowlist: {cmd}",
            metadata={"job_id": jid, "status": "failed"},
        )
        return True

    client.contribute(
        agent_name="job-worker",
        role="Worker",
        contribution_type="status",
        content=f"Job {jid} started: {cmd}",
        metadata={"job_id": jid, "status": "running"},
    )

    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("JOB_TIMEOUT", "300")),
            cwd=os.getenv("JOB_WORKDIR", str(ROOT)),
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        status = "succeeded" if proc.returncode == 0 else "failed"
    except Exception as e:
        out = str(e)
        status = "failed"

    client.contribute(
        agent_name="job-worker",
        role="Worker",
        contribution_type="status",
        content=f"Job {jid} {status}.\n\n$ {cmd}\n\n{out[:8000]}",
        metadata={"job_id": jid, "status": status},
    )
    if out.strip():
        client.add_artifact(
            name=f"job-{jid}.log",
            content=out[:50000],
            kind="file",
            project_id=job.get("project_id") or "",
        )
    return True


def main() -> None:
    base = os.getenv("BRIDGE_URL", "http://localhost:8080")
    key = os.getenv("BRIDGE_API_KEY") or None
    client = BridgeClient(base_url=base, api_key=key)
    interval = int(os.getenv("JOB_POLL_INTERVAL", "15"))
    print(f"Job worker polling {base} every {interval}s")
    while True:
        try:
            claim_and_run(client, base, key)
        except Exception as e:
            print("worker error:", e)
        time.sleep(interval)


if __name__ == "__main__":
    main()
