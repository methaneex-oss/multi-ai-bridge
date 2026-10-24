"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

type EngTask = {
  id: string;
  project_id?: string;
  title: string;
  objective?: string;
  acceptance?: string;
  owner?: string;
  status: string;
  evidence?: string;
};

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;

const STATUSES = [
  "open",
  "in_progress",
  "implemented",
  "under_review",
  "verified",
  "integrated",
  "blocked",
  "failed",
  "cancelled",
];

export function EngineeringPanel({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<EngTask[]>([]);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [checkName, setCheckName] = useState("acceptance-check");
  const [verifyTaskId, setVerifyTaskId] = useState("");

  const load = useCallback(async () => {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(bridge(`api/v1/engineering-tasks${q}`));
    if (res.ok) setTasks(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createTask() {
    if (!title.trim()) return setMsg("Title required");
    const res = await fetch(bridge("api/v1/engineering-tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        objective: objective.trim(),
        acceptance: acceptance.trim(),
        project_id: projectId || undefined,
        status: "open",
      }),
    });
    const text = await res.text();
    if (!res.ok) return setMsg(text.slice(0, 160));
    setTitle("");
    setObjective("");
    setAcceptance("");
    setMsg("Engineering task created");
    await load();
  }

  async function advance(id: string, status: string) {
    const res = await fetch(bridge("api/v1/engineering-tasks"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(
        data.error
          ? `${data.error}: ${data.hint || `${data.from}→${data.to}` || ""}`
          : JSON.stringify(data).slice(0, 160)
      );
      return;
    }
    setMsg(`Status ${data.from || "?"} → ${data.to || status}`);
    await load();
  }

  async function addVerification(result: "pass" | "fail") {
    const tid = verifyTaskId || tasks[0]?.id;
    if (!tid) return setMsg("No task to verify");
    const res = await fetch(bridge("api/v1/verifications"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: tid,
        project_id: projectId || undefined,
        check_name: checkName || "acceptance-check",
        result,
        summary: result === "pass" ? "Manual verification recorded" : "Failed check",
        verified_by: "human-ui",
      }),
    });
    const text = await res.text();
    if (!res.ok) return setMsg(text.slice(0, 160));
    setMsg(`Verification ${result} recorded for ${tid}`);
  }

  return (
    <div style={card}>
      <h3 style={h3}>Engineering tasks (durable)</h3>
      <p style={help}>
        Board task (step 3) is the active unit of work. Engineering tasks track multi-step work with handbook statuses.
        Status <b>verified</b> requires a passing verification record — not just a claim.
      </p>
      {msg && <div style={toast}>{msg}</div>}
      <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input style={input} placeholder="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
      <input style={input} placeholder="Acceptance criteria" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
      <button type="button" style={primary} onClick={createTask}>
        Create engineering task
      </button>

      <div style={{ marginTop: 12 }}>
        {tasks.length === 0 && <p style={help}>No engineering tasks yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                [{t.status}] {t.title}
              </div>
              <div style={{ fontSize: 11, color: "#9aa0a6" }}>{t.id}</div>
              {t.objective && <div style={{ fontSize: 12, color: "#c5cae0" }}>{t.objective}</div>}
            </div>
            <select
              style={{ ...input, width: "auto", marginBottom: 0, fontSize: 12 }}
              value={t.status}
              onChange={(e) => advance(t.id, e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <h4 style={{ ...h3, marginTop: 16, fontSize: 13 }}>Independent verification</h4>
      <p style={help}>Record pass/fail evidence before moving a task to verified.</p>
      <input
        style={input}
        placeholder="Task id (defaults to first)"
        value={verifyTaskId}
        onChange={(e) => setVerifyTaskId(e.target.value)}
      />
      <input style={input} placeholder="Check name" value={checkName} onChange={(e) => setCheckName(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={primary} onClick={() => addVerification("pass")}>
          Record pass
        </button>
        <button type="button" style={danger} onClick={() => addVerification("fail")}>
          Record fail
        </button>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "#14171e",
  border: "1px solid #252a35",
  borderRadius: 14,
  padding: 14,
  marginTop: 12,
};
const h3: CSSProperties = { margin: "0 0 8px", fontSize: 14, fontWeight: 700 };
const help: CSSProperties = { margin: "0 0 10px", fontSize: 12, color: "#9aa0a6", lineHeight: 1.4 };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 8,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2a2e35",
  background: "#0b0d12",
  color: "#e8eaed",
  fontSize: 14,
};
const primary: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const danger: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#7f1d1d",
  color: "#fecaca",
  fontWeight: 600,
  cursor: "pointer",
};
const toast: CSSProperties = {
  background: "#064e3b",
  color: "#a7f3d0",
  padding: "8px 10px",
  borderRadius: 8,
  marginBottom: 8,
  fontSize: 12,
};
const row: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #1a1d24",
};
