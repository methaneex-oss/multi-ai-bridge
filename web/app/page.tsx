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
type Job = { id: string; type: string; command: string; status: string; created_at?: string };

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:8080";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";

  const refreshLists = useCallback(async () => {
    try {
      const [h, p, j] = await Promise.all([
        fetch(`${bridgeUrl}/api/v1/history?limit=30`),
        fetch(`${bridgeUrl}/api/v1/projects`),
        fetch(`${bridgeUrl}/api/v1/jobs`),
      ]);
      if (h.ok) setHistory(await h.json());
      if (p.ok) setProjects(await p.json());
      if (j.ok) setJobs(await j.json());
    } catch { /* ignore */ }
  }, [bridgeUrl]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const poll = async () => {
      try {
        const res = await fetch(`${bridgeUrl}/api/v1/state`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState(await res.json());
        setError(null);
        await refreshLists();
      } catch (e: any) {
        setError(e.message || "Failed to load");
      }
    };

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { setLive(true); setError(null); refreshLists(); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === "state") setState(msg.data);
          if (msg.event === "contribution") setHistory((prev) => [msg.data, ...prev].slice(0, 30));
          if (msg.event === "job") setJobs((prev) => [msg.data, ...prev].slice(0, 30));
        } catch { /* ignore */ }
      };
      ws.onerror = () => setLive(false);
      ws.onclose = () => setLive(false);
    } catch { /* fallback poll only */ }

    poll();
    pollId = setInterval(poll, 5000);
    return () => {
      closed = true;
      if (ws) ws.close();
      if (pollId) clearInterval(pollId);
    };
  }, [bridgeUrl, wsUrl, refreshLists]);

  return (
    <main style={{ fontFamily: "system-ui,sans-serif", padding: 24, maxWidth: 1000, margin: "0 auto", background: "#0f1115", color: "#e8eaed", minHeight: "100vh" }}>
      <header style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Multi-AI Bridge</h1>
          <p style={{ color: "#9aa0a6", marginTop: 4 }}>Projects · Agents · Jobs · Live coordination</p>
        </div>
        <span style={{
          fontSize: 12, padding: "4px 10px", borderRadius: 999,
          background: live ? "#0d3b2e" : "#3c1518", color: live ? "#6ee7b7" : "#fca5a5",
        }}>{live ? "● Live" : "○ Polling"}</span>
      </header>

      {error && (
        <div style={{ background: "#3c1518", border: "1px solid #8b3a3a", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          Bridge {bridgeUrl}: {error}
        </div>
      )}

      {state && (
        <>
          <section style={card}>
            <h2 style={h2}>Current Task</h2>
            <p style={{ fontSize: 17, fontWeight: 600, margin: "0 0 6px" }}>{state.task_title || "(no task)"}</p>
            <p style={{ color: "#bdc1c6", margin: "0 0 8px" }}>{state.task_description}</p>
            <div style={{ fontSize: 13, color: "#9aa0a6" }}>
              Status: <strong style={{ color: "#8ab4f8" }}>{state.current_status}</strong>
              {state.agent_lock ? ` · Lock: ${state.agent_lock}` : ""}
              {state.project_id ? ` · Project: ${state.project_id}` : ""}
              {` · v${state.version}`}
            </div>
          </section>

          {state.instructions && (
            <section style={{ ...card, marginTop: 12, borderColor: "#3b4a6b" }}>
              <h2 style={h2}>Project Rules</h2>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#c5cae0" }}>{state.instructions}</pre>
            </section>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <section style={card}>
              <h2 style={h2}>Projects</h2>
              {projects?.length ? projects.map((p) => (
                <div key={p.id} style={{ padding: "6px 0", borderBottom: "1px solid #2a2e35", fontSize: 14 }}>
                  <strong>{p.name}</strong>
                  <div style={{ color: "#9aa0a6", fontSize: 12 }}>{p.id}</div>
                </div>
              )) : <p style={{ color: "#9aa0a6" }}>None yet</p>}
            </section>
            <section style={card}>
              <h2 style={h2}>Jobs (build / test / run)</h2>
              {jobs?.length ? jobs.slice(0, 10).map((j) => (
                <div key={j.id} style={{ padding: "6px 0", borderBottom: "1px solid #2a2e35", fontSize: 13 }}>
                  <span style={{ color: j.status === "queued" ? "#fbbf24" : j.status === "succeeded" ? "#6ee7b7" : "#e8eaed" }}>{j.status}</span>
                  {" · "}{j.type}{": "}<code>{j.command}</code>
                </div>
              )) : <p style={{ color: "#9aa0a6" }}>No jobs queued</p>}
            </section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <section style={card}>
              <h2 style={h2}>Agents & Roles</h2>
              {state.roles && Object.keys(state.roles).length ? Object.entries(state.roles).map(([a, r]) => (
                <div key={a} style={{ padding: "4px 0", borderBottom: "1px solid #2a2e35" }}>
                  <strong>{a}</strong><span style={{ float: "right", color: "#8ab4f8" }}>{r}</span>
                </div>
              )) : <p style={{ color: "#9aa0a6" }}>No roles</p>}
            </section>
            <section style={card}>
              <h2 style={h2}>Open Questions</h2>
              {state.open_questions?.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>{state.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              ) : <p style={{ color: "#9aa0a6" }}>None</p>}
            </section>
          </div>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Contribution Timeline</h2>
            {history.length === 0 ? <p style={{ color: "#9aa0a6" }}>Empty</p> : history.map((c) => (
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

const card: React.CSSProperties = { background: "#16181d", border: "1px solid #2a2e35", borderRadius: 12, padding: 16 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "#9aa0a6", textTransform: "uppercase", letterSpacing: 0.6 };
