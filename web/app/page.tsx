"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "overview" | "tasks" | "activity" | "providers";

type State = {
  task_title?: string;
  task_description?: string;
  instructions?: string;
  current_status?: string;
  open_questions?: string[];
  version?: number;
};

type Contribution = {
  id: string;
  agent_name: string;
  role: string;
  content: string;
  contribution_type: string;
};

type Provider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  enabled: boolean;
  role: string;
  last_test?: string;
  last_ok?: boolean;
};

const api = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS_KEY = "mab_providers_v1";

const PRESETS: Partial<Provider>[] = [
  { name: "openrouter", base_url: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat", role: "Coder" },
  { name: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", role: "Reviewer" },
  { name: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", role: "Coder" },
  { name: "xai", base_url: "https://api.x.ai/v1", model: "grok-3-mini", role: "Architect" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState({ name: "", base_url: "", model: "", api_key: "", role: "Agent" });
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setProviders(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(providers));
    } catch { /* ignore */ }
  }, [providers]);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(api("api/v1/state")), fetch(api("api/v1/history"))]);
      if (!s.ok) {
        const t = await s.text();
        let d = t;
        try {
          const j = JSON.parse(t);
          d = j.detail || j.error || t;
        } catch { /* */ }
        throw new Error(d);
      }
      setState(await s.json());
      if (h.ok) {
        const hj = await h.json();
        setHistory(Array.isArray(hj) ? hj : []);
      }
      setError(null);
    } catch (e: any) {
      setError(e.message || "Backend unreachable");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  async function publishTask() {
    if (!title.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(api("api/v1/task"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          instructions: instructions.trim(),
          goals: [],
          constraints: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("Task published");
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(p: Provider) {
    setTesting(p.id);
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: p.base_url, model: p.model, api_key: p.api_key }),
      });
      const data = await res.json();
      setProviders((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? { ...x, last_ok: !!data.ok, last_test: data.ok ? "Works: ready" : String(data.error || "failed") }
            : x
        )
      );
    } catch (e: any) {
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, last_ok: false, last_test: e.message } : x))
      );
    } finally {
      setTesting(null);
    }
  }

  function saveProvider() {
    if (!form.name || !form.base_url || !form.model) return;
    const id = form.name.toLowerCase().replace(/\s+/g, "-");
    setProviders((prev) => {
      const existing = prev.find((p) => p.id === id);
      const next: Provider = {
        id,
        name: form.name,
        base_url: form.base_url,
        model: form.model,
        api_key: form.api_key || existing?.api_key || "",
        enabled: existing?.enabled ?? true,
        role: form.role || "Agent",
        last_test: existing?.last_test,
        last_ok: existing?.last_ok,
      };
      if (existing) return prev.map((p) => (p.id === id ? next : p));
      return [...prev, next];
    });
    setForm({ name: "", base_url: "", model: "", api_key: "", role: "Agent" });
    setMsg("Provider saved");
  }

  function applyPreset(pr: Partial<Provider>) {
    setForm({
      name: pr.name || "",
      base_url: pr.base_url || "",
      model: pr.model || "",
      api_key: "",
      role: pr.role || "Agent",
    });
  }

  async function runAgents() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
      const ok = (data.results || []).filter((r: any) => r.ok).length;
      const bad = (data.results || []).filter((r: any) => !r.ok);
      setMsg(`Run done: ${ok} ok` + (bad.length ? `, ${bad.length} failed — ${bad[0]?.detail || ""}` : ""));
      if (data.state) setState(data.state);
      if (data.history) setHistory(data.history);
      else await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "activity", label: "Activity" },
    { id: "providers", label: "Providers" },
  ];

  return (
    <main style={page}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Multi-AI Bridge</h1>
        <p style={{ margin: "4px 0 0", color: "#9aa0a6", fontSize: 12 }}>Shared state · Providers · Agents</p>
      </header>

      <nav style={nav}>
        {tabs.map((t) => (
          <button key={t.id} style={tab === t.id ? tabOn : tabOff} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div style={errBox}>
          {error}
          <button style={{ ...btn, marginTop: 8, background: "#4b5563" }} onClick={() => refresh()}>
            Retry
          </button>
        </div>
      )}
      {msg && <div style={{ color: "#6ee7b7", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {tab === "overview" && (
        <>
          <section style={card}>
            <button style={{ ...btn, background: running ? "#374151" : "#10b981" }} disabled={running} onClick={runAgents}>
              {running ? "Running…" : "▶ Run enabled providers"}
            </button>
            <p style={{ color: "#9aa0a6", fontSize: 12, marginTop: 10 }}>
              Uses Providers you enabled & tested. Fallback: OPENROUTER_API_KEY on server.
            </p>
          </section>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Current task</h2>
            <p style={{ fontWeight: 600, margin: "0 0 6px" }}>{state?.task_title || "(none)"}</p>
            <p style={{ color: "#bdc1c6", fontSize: 14, margin: 0 }}>{state?.task_description}</p>
            <p style={{ color: "#9aa0a6", fontSize: 12, marginTop: 8 }}>Status: {state?.current_status || "idle"} · v{state?.version ?? 0}</p>
          </section>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Providers snapshot</h2>
            {!providers.length ? (
              <p style={{ color: "#9aa0a6", fontSize: 13 }}>None — open Providers tab</p>
            ) : (
              providers.map((p) => (
                <div key={p.id} style={row}>
                  <strong>{p.name}</strong> {p.enabled ? "· on" : "· off"}
                  <div style={{ fontSize: 12, color: p.last_ok ? "#6ee7b7" : "#fca5a5" }}>
                    {p.last_test || "not tested"}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {tab === "tasks" && (
        <section style={card}>
          <h2 style={h2}>Set task + rules</h2>
          <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Instructions for all agents" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <button style={btn} disabled={busy} onClick={publishTask}>
            Publish task
          </button>
        </section>
      )}

      {tab === "activity" && (
        <section style={card}>
          <h2 style={h2}>Contribution timeline</h2>
          {!history.length ? (
            <p style={{ color: "#9aa0a6", fontSize: 13 }}>Empty — run providers from Overview</p>
          ) : (
            history.map((c) => (
              <div key={c.id} style={contrib}>
                <div style={{ fontSize: 11, color: "#9aa0a6" }}>
                  <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role} · {c.contribution_type}
                </div>
                <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>{c.content}</pre>
              </div>
            ))
          )}
        </section>
      )}

      {tab === "providers" && (
        <>
          <section style={card}>
            <h2 style={h2}>Your providers</h2>
            {!providers.length && <p style={{ color: "#9aa0a6", fontSize: 13 }}>Add OpenRouter first — one key, many models.</p>}
            {providers.map((p) => (
              <div key={p.id} style={{ ...contrib, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 12, color: "#9aa0a6" }}>
                      {p.model} · {p.role}
                    </div>
                    <div style={{ fontSize: 12, color: p.last_ok ? "#6ee7b7" : "#fca5a5", marginTop: 4 }}>
                      {p.last_test || "not tested"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={smallBtn} onClick={() => testProvider(p)} disabled={testing === p.id}>
                      {testing === p.id ? "…" : "Test"}
                    </button>
                    <button
                      style={smallBtn}
                      onClick={() =>
                        setProviders((prev) => prev.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)))
                      }
                    >
                      {p.enabled ? "Disable" : "Enable"}
                    </button>
                    <button style={{ ...smallBtn, background: "#7f1d1d" }} onClick={() => setProviders((prev) => prev.filter((x) => x.id !== p.id))}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Presets</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PRESETS.map((pr) => (
                <button key={pr.name} style={smallBtn} onClick={() => applyPreset(pr)}>
                  {pr.name}
                </button>
              ))}
            </div>
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Add or edit provider</h2>
            <p style={{ color: "#9aa0a6", fontSize: 12 }}>Any OpenAI-compatible API. Leave key blank to keep existing.</p>
            <input style={input} placeholder="Name (e.g. openrouter)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input style={input} placeholder="Base URL" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            <input style={input} placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input style={input} placeholder="API key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            <input style={input} placeholder="Role (Architect / Coder / …)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <button style={btn} onClick={saveProvider}>
              Save provider
            </button>
          </section>
        </>
      )}
    </main>
  );
}

const page: React.CSSProperties = {
  fontFamily: "system-ui,sans-serif", padding: "14px 12px 48px", maxWidth: 720, margin: "0 auto",
  background: "#0b0d12", color: "#e8eaed", minHeight: "100vh",
};
const nav: React.CSSProperties = { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" };
const tabOn: React.CSSProperties = { padding: "8px 12px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 600, fontSize: 13 };
const tabOff: React.CSSProperties = { padding: "8px 12px", borderRadius: 8, border: "1px solid #252a35", background: "#14171e", color: "#c5cae0", fontSize: 13 };
const card: React.CSSProperties = { background: "#14171e", border: "1px solid #252a35", borderRadius: 14, padding: 14 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: "#9aa0a6", textTransform: "uppercase", letterSpacing: 0.6 };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "10px 12px",
  borderRadius: 10, border: "1px solid #2a2e35", background: "#0b0d12", color: "#e8eaed", fontSize: 14,
};
const btn: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 10, border: "none", background: "#3b82f6", color: "#fff",
  fontWeight: 600, width: "100%", fontSize: 14,
};
const smallBtn: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", fontSize: 12, fontWeight: 600,
};
const errBox: React.CSSProperties = { background: "#2a1215", border: "1px solid #7f1d1d", padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 13 };
const row: React.CSSProperties = { padding: "8px 0", borderBottom: "1px solid #252a35", fontSize: 13 };
const contrib: React.CSSProperties = { background: "#0b0d12", borderRadius: 10, padding: 12, border: "1px solid #252a35" };
