"use client";

import { useEffect, useState } from "react";

type State = {
  task_title?: string;
  task_description?: string;
  goals?: string[];
  constraints?: string[];
  roles?: Record<string, string>;
  open_questions?: string[];
  decisions?: string[];
  current_status?: string;
  version?: number;
};

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:8080";

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${bridgeUrl}/api/v1/state`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setState(data);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Failed to load state");
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [bridgeUrl]);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Multi-AI Bridge</h1>
      <p style={{ color: "#666" }}>Live shared state for coordinating multiple AI agents</p>

      {error && (
        <div style={{ background: "#fee", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          Cannot reach bridge at {bridgeUrl}: {error}
        </div>
      )}

      {state && (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2>Current Task</h2>
            <p><strong>{state.task_title || "(no task set)"}</strong></p>
            <p>{state.task_description || ""}</p>
            <p style={{ fontSize: 14, color: "#555" }}>Status: {state.current_status} · Version: {state.version}</p>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Roles</h2>
            {state.roles && Object.keys(state.roles).length > 0 ? (
              <ul>
                {Object.entries(state.roles).map(([agent, role]) => (
                  <li key={agent}><strong>{agent}</strong> → {role}</li>
                ))}
              </ul>
            ) : (
              <p>No roles assigned yet</p>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2>Open Questions</h2>
            {state.open_questions && state.open_questions.length > 0 ? (
              <ul>
                {state.open_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <p>None</p>
            )}
          </section>

          <section>
            <h2>Decisions</h2>
            {state.decisions && state.decisions.length > 0 ? (
              <ul>
                {state.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <p>None yet</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
