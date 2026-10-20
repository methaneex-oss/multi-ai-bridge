"use client";

import { useEffect, useState, useCallback } from "react";

type State = {
  task_title?: string;
  task_description?: string;
  instructions?: string;
  goals?: string[];
  constraints?: string[];
  roles?: Record<string, string>;
  open_questions?: string[];
  decisions?: string[];
  current_status?: string;
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

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:8080";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${bridgeUrl}/api/v1/history?limit=30`);
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ }
  }, [bridgeUrl]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const fallbackPoll = () => {
      const tick = async () => {
        try {
          const res = await fetch(`${bridgeUrl}/api/v1/state`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setState(await res.json());
          setError(null);
          await loadHistory();
        } catch (e: any) {
          setError(e.message || "Failed to load");
        }
      };
      tick();
      pollId = setInterval(tick, 4000);
    };

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (closed) return;
        setLive(true);
        setError(null);
        loadHistory();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === "state") setState(msg.data);
          if (msg.event === "contribution") {
            setHistory((prev) => [msg.data, ...prev].slice(0, 30));
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => {
        setLive(false);
        if (!pollId) fallbackPoll();
      };
      ws.onclose = () => {
        setLive(false);
        if (!closed && !pollId) fallbackPoll();
      };
    } catch {
      fallbackPoll();
    }

    // always seed once via REST
    fallbackPoll();

    return () => {
      closed = true;
      if (ws) ws.close();
      if (pollId) clearInterval(pollId);
    };
  }, [bridgeUrl, wsUrl, loadHistory]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 960, margin: "0 auto", background: "#0f1115", color: "#e8eaed", minHeight: "100vh" }}>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Multi-AI Bridge</h1>
          <p style={{ color: "#9aa0a6", marginTop: 4 }}>Live coordination for multiple AI agents</p>
        </div>
        <span style={{
          fontSize: 12, padding: "4px 10px", borderRadius: 999,
          background: live ? "#0d3b2e" : "#3c1518",
          color: live ? "#6ee7b7" : "#fca5a5",
          border: `1px solid ${live ? "#065f46" : "#7f1d1d"}`,
        }}>
          {live ? "● Live (WebSocket)" : "○ Polling"}
        </span>
      </header>

      {error && (
        <div style={{ background: "#3c1518", border: "1px solid #8b3a3a", padding: 14, borderRadius: 8, marginBottom: 20 }}>
          Cannot reach bridge at <code>{bridgeUrl}</code>: {error}
        </div>
      )}

      {state && (
        <>
          <section style={cardStyle}>
            <h2 style={h2Style}>Current Task</h2>
            <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>{state.task_title || "(no task set)"}</p>
            <p style={{ color: "#bdc1c6", margin: "0 0 12px" }}>{state.task_description || ""}</p>
            <div style={{ fontSize: 13, color: "#9aa0a6" }}>
              Status: <strong style={{ color: "#8ab4f8" }}>{state.current_status}</strong> · Version {state.version}
            </div>
            {state.goals && state.goals.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>Goals</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {state.goals.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}
          </section>

          {state.instructions && (
            <section style={{ ...cardStyle, marginTop: 16, borderColor: "#3b4a6b" }}>
              <h2 style={h2Style}>Project Instructions / Rules</h2>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#c5cae0" }}>
                {state.instructions}
              </pre>
            </section>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <section style={cardStyle}>
              <h2 style={h2Style}>Agents & Roles</h2>
              {state.roles && Object.keys(state.roles).length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {Object.entries(state.roles).map(([agent, role]) => (
                    <li key={agent} style={{ padding: "6px 0", borderBottom: "1px solid #2a2e35" }}>
                      <strong>{agent}</strong>
                      <span style={{ float: "right", color: "#8ab4f8" }}>{role}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "#9aa0a6" }}>No roles assigned yet</p>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={h2Style}>Open Questions</h2>
              {state.open_questions && state.open_questions.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {state.open_questions.map((q, i) => <li key={i} style={{ marginBottom: 6 }}>{q}</li>)}
                </ul>
              ) : (
                <p style={{ color: "#9aa0a6" }}>None</p>
              )}
            </section>
          </div>

          <section style={{ ...cardStyle, marginTop: 16 }}>
            <h2 style={h2Style}>Decisions</h2>
            {state.decisions && state.decisions.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {state.decisions.map((d, i) => <li key={i} style={{ marginBottom: 6 }}>{d}</li>)}
              </ul>
            ) : (
              <p style={{ color: "#9aa0a6" }}>None yet</p>
            )}
          </section>

          <section style={{ ...cardStyle, marginTop: 16 }}>
            <h2 style={h2Style}>Contribution Timeline</h2>
            {history.length === 0 ? (
              <p style={{ color: "#9aa0a6" }}>No contributions yet</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {history.map((c) => (
                  <div key={c.id} style={{ background: "#1a1d23", borderRadius: 8, padding: 12, border: "1px solid #2a2e35" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                      <span>
                        <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong>
                        <span style={{ color: "#8ab4f8", marginLeft: 8 }}>{c.role}</span>
                        <span style={{ color: "#9aa0a6", marginLeft: 8 }}>· {c.contribution_type}</span>
                      </span>
                      <span style={{ color: "#9aa0a6" }}>{c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}</span>
                    </div>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#bdc1c6" }}>
                      {c.content}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#16181d",
  border: "1px solid #2a2e35",
  borderRadius: 12,
  padding: 20,
};

const h2Style: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 15,
  fontWeight: 600,
  color: "#9aa0a6",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
