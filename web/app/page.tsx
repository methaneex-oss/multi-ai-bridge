"use client";

import { useCallback, useEffect, useState } from "react";

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

const api = (path: string) => `/api/bridge/${path.replace(/^\//, "")}`;

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectName, setProjectName] = useState("");

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "";

  const refresh = useCallback(async () => {
    try {
      const [s, h, p] = await Promise.all([
        fetch(api("api/v1/state")),
        fetch(api("api/v1/history")),
        fetch(api("api/v1/projects")),
      ]);
      if (!s.ok) {
        const t = await s.text();
        let detail = t;
        try {
          const j = JSON.parse(t);
          detail = j.detail || j.error || t;
          if (j.hint) setHint(j.hint);
        } catch {
          setHint(null);
        }
        throw new Error(detail || `HTTP ${s.status}`);
      }
      setState(await s.json());
      if (h.ok) {
        const hj = await h.json();
        setHistory(Array.isArray(hj) ? hj : []);
      }
      if (p.ok) {
        const pj = await p.json();
        setProjects(Array.isArray(pj) ? pj : []);
      }
      setError(null);
      setHint(null);
    } catch (e: any) {
      setError(e.message || "Failed to reach backend");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    let ws: WebSocket | null = null;
    if (wsUrl) {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setLive(true);
        ws.onclose = () => setLive(false);
        ws.onerror = () => setLive(false);
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m.event === "state") setState(m.data);
            if (m.event === "contribution") {
              setHistory((prev) => [m.data, ...prev].slice(0, 40));
            }
          } catch { /* ignore */ }
        };
      } catch { /* poll only */ }
    }
    return () => {
      clearInterval(id);
      ws?.close();
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
      setMsg("Saved");
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

  async function onRunAgents() {
    setRunning(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/run-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.hint || `Run failed ${res.status}`);
      const ok = (data.results || []).filter((r: any) => r.ok).length;
      const fail = (data.results || []).filter((r: any) => !r.ok);
      setMsg(`Agents finished: ${ok} ok` + (fail.length ? `, ${fail.length} failed` : ""));
      if (data.state) setState(data.state);
      if (data.history) setHistory(data.history);
      else await refresh();
      if (fail[0]?.detail) setHint(fail[0].detail);
    } catch (e: any) {
      setError(e.message || "Run agents failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Multi-AI Bridge</h1>
          <p style={{ color: "#9aa0a6", margin: "4px 0 0", fontSize: 13 }}>Shared state · Agents · Live</p>
        </div>
        <span style={{
          fontSize: 11, padding: "5px 10px", borderRadius: 999, fontWeight: 600,
          background: live ? "#0d3b2e" : error ? "#3c1518" : "#1e3a5f",
          color: live ? "#6ee7b7" : error ? "#fca5a5" : "#93c5fd",
        }}>
          {live ? "● Live" : error ? "○ Offline" : "○ Connected"}
        </span>
      </header>

      {error && (
        <div style={errBox}>
          <strong>Backend issue</strong>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4 }}>{error}</div>
          {hint && <div style={{ marginTop: 8, fontSize: 12, color: "#fcd34d" }}>{hint}</div>}
          <button style={{ ...btn, marginTop: 12, background: "#4b5563" }} onClick={() => refresh()}>
            Retry connection
          </button>
        </div>
      )}

      {msg && <div style={{ color: "#6ee7b7", marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      <section style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={{ ...btn, background: running ? "#374151" : "#10b981", flex: 1, minWidth: 140 }} disabled={running || busy} onClick={onRunAgents}>
            {running ? "Running agents…" : "▶ Run agents"}
          </button>
          <button style={{ ...btn, background: "#374151" }} disabled={busy} onClick={() => refresh()}>
            Refresh
          </button>
        </div>
        <p style={{ color: "#9aa0a6", fontSize: 12, margin: "10px 0 0", lineHeight: 1.4 }}>
          Needs <code style={code}>OPENROUTER_API_KEY</code> on this UI service in Render.
        </p>
      </section>

      <div style={grid2}>
        <section style={card}>
          <h2 style={h2}>New project</h2>
          <input style={input} placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <button style={btn} disabled={busy} onClick={onCreateProject}>Create project</button>
        </section>
        <section style={card}>
          <h2 style={h2}>Set task + rules</h2>
          <input style={input} placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...input, minHeight: 52 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea style={{ ...input, minHeight: 52 }} placeholder="Rules for all agents" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <button style={btn} disabled={busy} onClick={onSetTask}>Publish task</button>
        </section>
      </div>

      {state && (
        <>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Current task</h2>
            <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>{state.task_title || "(no task yet — publish one or Run agents)"}</p>
            <p style={{ color: "#bdc1c6", margin: "0 0 8px", fontSize: 14 }}>{state.task_description}</p>
            <div style={{ fontSize: 12, color: "#9aa0a6" }}>
              Status: <strong style={{ color: "#8ab4f8" }}>{state.current_status || "idle"}</strong>
              {state.project_id ? ` · Project ${state.project_id}` : ""}
              {` · v${state.version ?? 0}`}
            </div>
            {state.instructions && (
              <pre style={pre}>{state.instructions}</pre>
            )}
          </section>

          <div style={{ ...grid2, marginTop: 12 }}>
            <section style={card}>
              <h2 style={h2}>Projects</h2>
              {projects.length ? projects.map((p) => (
                <div key={p.id} style={row}>
                  <strong>{p.name}</strong>
                  <div style={{ color: "#9aa0a6", fontSize: 11 }}>{p.id}</div>
                </div>
              )) : <p style={{ color: "#9aa0a6", fontSize: 13, margin: 0 }}>None yet</p>}
            </section>
            <section style={card}>
              <h2 style={h2}>Open questions</h2>
              {state.open_questions?.length
                ? <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{state.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                : <p style={{ color: "#9aa0a6", fontSize: 13, margin: 0 }}>None</p>}
            </section>
          </div>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Contribution timeline</h2>
            {!history.length ? (
              <p style={{ color: "#9aa0a6", fontSize: 13, margin: 0 }}>Empty — press <strong>Run agents</strong> after setting a task.</p>
            ) : history.map((c) => (
              <div key={c.id} style={contrib}>
                <div style={{ fontSize: 11, color: "#9aa0a6", marginBottom: 4 }}>
                  <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role} · {c.contribution_type}
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#c5cae0" }}>{c.content}</pre>
              </div>
            ))}
          </section>
        </>
      )}

      <footer style={{ marginTop: 24, fontSize: 11, color: "#6b7280", textAlign: "center" }}>
        API must be awake · Free tier may sleep ~15 min idle
      </footer>
    </main>
  );
}

const page: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif", padding: "16px 14px 40px", maxWidth: 720, margin: "0 auto",
  background: "#0b0d12", color: "#e8eaed", minHeight: "100vh",
};
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 };
const card: React.CSSProperties = { background: "#14171e", border: "1px solid #252a35", borderRadius: 14, padding: 14 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#9aa0a6", textTransform: "uppercase", letterSpacing: 0.7 };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "10px 12px",
  borderRadius: 10, border: "1px solid #2a2e35", background: "#0b0d12", color: "#e8eaed", fontSize: 14,
};
const btn: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff",
  fontWeight: 600, cursor: "pointer", fontSize: 14, width: "100%",
};
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 12 };
const row: React.CSSProperties = { padding: "8px 0", borderBottom: "1px solid #252a35", fontSize: 13 };
const errBox: React.CSSProperties = { background: "#2a1215", border: "1px solid #7f1d1d", padding: 14, borderRadius: 12, marginBottom: 14 };
const pre: React.CSSProperties = { marginTop: 12, whiteSpace: "pre-wrap", fontSize: 12, color: "#c5cae0", background: "#0b0d12", padding: 12, borderRadius: 10 };
const contrib: React.CSSProperties = { background: "#0b0d12", borderRadius: 10, padding: 12, marginBottom: 10, border: "1px solid #252a35" };
const code: React.CSSProperties = { background: "#1f2937", padding: "1px 5px", borderRadius: 4, fontSize: 11 };
