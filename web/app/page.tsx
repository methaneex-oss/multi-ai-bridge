"use client";

import { useEffect, useState, useCallback } from "react";

type State = {
  task_title?: string;
  task_description?: string;
  instructions?: string;
  goals?: string[];
  roles?: Record<string, string>;
  open_questions?: string[];
  decisions?: string[];
  current_status?: string;
  agent_lock?: string;
  project_id?: string;
  version?: number;
};

type Contribution = {
  id: string;
  timestamp: string;
  agent_name: string;
  role: string;
  content: string;
  contribution_type: string;
};

type Project = { id: string; name: string; description?: string };
type Job = { id: string; type: string; command: string; status: string };

/** Browser talks to same-origin /api/bridge/* (server adds API key). */
const api = (path: string) => `/api/bridge/${path.replace(/^\//, "")}`;

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // forms
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectName, setProjectName] = useState("");

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "";

  const refresh = useCallback(async () => {
    try {
      const [s, h, p, j] = await Promise.all([
        fetch(api("api/v1/state")),
        fetch(api("api/v1/history")),
        fetch(api("api/v1/projects")),
        fetch(api("api/v1/jobs")),
      ]);
      if (!s.ok) throw new Error(`state ${s.status}`);
      setState(await s.json());
      if (h.ok) setHistory(await h.json());
      if (p.ok) setProjects(await p.json());
      if (j.ok) setJobs(await j.json());
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to reach bridge");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);

    let ws: WebSocket | null = null;
    if (wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setLive(true);
        ws.onclose = () => setLive(false);
        ws.onerror = () => setLive(false);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event === "state") setState(msg.data);
            if (msg.event === "contribution") {
              setHistory((prev) => [msg.data, ...prev].slice(0, 40));
            }
            if (msg.event === "job") {
              setJobs((prev) => [msg.data, ...prev].slice(0, 30));
            }
          } catch { /* ignore */ }
        };
      } catch { /* poll only */ }
    }

    return () => {
      clearInterval(id);
      if (ws) ws.close();
    };
  }, [refresh, wsUrl]);

  async function postJSON(path: string, body: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(api(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      setMsg("OK");
      await refresh();
      return data;
    } catch (e: any) {
      setMsg(e.message || "failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function onCreateProject() {
    if (!projectName.trim()) return;
    await postJSON("api/v1/projects", { name: projectName.trim(), description: "" });
    setProjectName("");
  }

  async function onSetTask() {
    if (!title.trim()) return;
    await postJSON("api/v1/task", {
      title: title.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      goals: [],
      constraints: [],
      project_id: state?.project_id || "",
    });
  }

  return (
    <main style={page}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Multi-AI Bridge</h1>
          <p style={{ color: "#9aa0a6", margin: "4px 0 0" }}>Projects · Agents · Jobs · Live</p>
        </div>
        <span style={{
          fontSize: 12, padding: "4px 10px", borderRadius: 999,
          background: live ? "#0d3b2e" : "#2a2e35",
          color: live ? "#6ee7b7" : "#9aa0a6",
        }}>{live ? "● Live WS" : "○ Polling"}</span>
      </header>

      {error && (
        <div style={errBox}>Cannot reach backend via proxy: {error}. Set BRIDGE_URL on the host.</div>
      )}
      {msg && <div style={{ color: "#6ee7b7", marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <section style={card}>
          <h2 style={h2}>New project</h2>
          <input style={input} placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <button style={btn} disabled={busy} onClick={onCreateProject}>Create project</button>
        </section>
        <section style={card}>
          <h2 style={h2}>Set task + rules</h2>
          <input style={input} placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Instructions / rules for all agents" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <button style={btn} disabled={busy} onClick={onSetTask}>Publish task</button>
        </section>
      </div>

      {state && (
        <>
          <section style={card}>
            <h2 style={h2}>Current task</h2>
            <p style={{ fontSize: 17, fontWeight: 600, margin: "0 0 6px" }}>{state.task_title || "(none)"}</p>
            <p style={{ color: "#bdc1c6", margin: "0 0 8px" }}>{state.task_description}</p>
            <div style={{ fontSize: 13, color: "#9aa0a6" }}>
              Status: <strong style={{ color: "#8ab4f8" }}>{state.current_status}</strong>
              {state.agent_lock ? ` · Lock: ${state.agent_lock}` : ""}
              {state.project_id ? ` · Project: ${state.project_id}` : ""}
              {` · v${state.version ?? 0}`}
            </div>
            {state.instructions && (
              <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13, color: "#c5cae0", background: "#1a1d23", padding: 12, borderRadius: 8 }}>
                {state.instructions}
              </pre>
            )}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <section style={card}>
              <h2 style={h2}>Projects</h2>
              {projects?.length ? projects.map((p) => (
                <div key={p.id} style={row}>
                  <strong>{p.name}</strong>
                  <div style={{ color: "#9aa0a6", fontSize: 12 }}>{p.id}</div>
                </div>
              )) : <p style={{ color: "#9aa0a6" }}>None</p>}
            </section>
            <section style={card}>
              <h2 style={h2}>Jobs</h2>
              {jobs?.length ? jobs.slice(0, 8).map((j) => (
                <div key={j.id} style={row}>
                  <span style={{ color: j.status === "queued" ? "#fbbf24" : "#e8eaed" }}>{j.status}</span>
                  {" · "}{j.type}: <code>{j.command}</code>
                </div>
              )) : <p style={{ color: "#9aa0a6" }}>No jobs</p>}
            </section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <section style={card}>
              <h2 style={h2}>Agents & roles</h2>
              {state.roles && Object.keys(state.roles).length
                ? Object.entries(state.roles).map(([a, r]) => (
                  <div key={a} style={row}><strong>{a}</strong><span style={{ float: "right", color: "#8ab4f8" }}>{r}</span></div>
                ))
                : <p style={{ color: "#9aa0a6" }}>Assign via runners / API</p>}
            </section>
            <section style={card}>
              <h2 style={h2}>Open questions</h2>
              {state.open_questions?.length
                ? <ul style={{ margin: 0, paddingLeft: 18 }}>{state.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                : <p style={{ color: "#9aa0a6" }}>None</p>}
            </section>
          </div>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Contribution timeline</h2>
            <p style={{ color: "#9aa0a6", fontSize: 13, marginTop: 0 }}>
              Run LLMs from your machine: <code>python -m runners.run_once</code> with BRIDGE_URL + OPENROUTER_API_KEY.
            </p>
            {history.length === 0 ? <p style={{ color: "#9aa0a6" }}>Empty — run agents to fill this</p> : history.map((c) => (
              <div key={c.id} style={{ background: "#1a1d23", borderRadius: 8, padding: 12, marginBottom: 10, border: "1px solid #2a2e35" }}>
                <div style={{ fontSize: 12, color: "#9aa0a6", marginBottom: 4 }}>
                  <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role} · {c.contribution_type}
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#bdc1c6" }}>{c.content}</pre>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

const page: React.CSSProperties = {
  fontFamily: "system-ui,sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto",
  background: "#0f1115", color: "#e8eaed", minHeight: "100vh",
};
const card: React.CSSProperties = { background: "#16181d", border: "1px solid #2a2e35", borderRadius: 12, padding: 16 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "#9aa0a6", textTransform: "uppercase", letterSpacing: 0.6 };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "8px 10px",
  borderRadius: 8, border: "1px solid #2a2e35", background: "#0f1115", color: "#e8eaed",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff",
  fontWeight: 600, cursor: "pointer",
};
const row: React.CSSProperties = { padding: "6px 0", borderBottom: "1px solid #2a2e35", fontSize: 13 };
const errBox: React.CSSProperties = { background: "#3c1518", border: "1px solid #8b3a3a", padding: 12, borderRadius: 8, marginBottom: 16 };
