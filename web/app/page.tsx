"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";

type Tab = "overview" | "tasks" | "agents" | "activity" | "providers";
type State = { project_id?: string; task_title?: string; task_description?: string; version?: number; current_status?: string };
type Contribution = { id: string; agent_name: string; role: string; content: string; created_at?: string };

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS = "mab_ui_v4";
const OR = { base: "https://openrouter.ai/api/v1", keys: "https://openrouter.ai/keys" };

export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [work, setWork] = useState("");
  const [rules, setRules] = useState("");
  const [projectName, setProjectName] = useState("My project");
  const [projectId, setProjectId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>(DEFAULT_AGENTS.slice(0, 3));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const say = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 3500);
  };

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(LS) || "{}");
      if (d.apiKey) {
        setApiKey(d.apiKey);
        setModel(d.model || "");
        setConnected(!!d.apiKey);
      }
      if (d.projectId) setProjectId(d.projectId);
      if (d.projectName) setProjectName(d.projectName);
      if (d.work) setWork(d.work);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LS, JSON.stringify({ apiKey, model, projectId, projectName, work }));
  }, [apiKey, model, projectId, projectName, work]);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(bridge("api/v1/state")), fetch(bridge("api/v1/history"))]);
      if (s.ok) setState(await s.json());
      if (h.ok) setHistory(await h.json());
      setErr(null);
    } catch {
      setErr("Server waking up — wait 30s, then Refresh");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function freeModel() {
    const r = await fetch("/api/recommend-free?prefer=code", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    const list = d?.recommended || d?.models || [];
    return (list[0]?.id as string) || "openrouter/free";
  }

  async function connect() {
    if (!apiKey.trim()) return say("Paste your OpenRouter key");
    setBusy(true);
    setErr(null);
    try {
      let m = model.trim() || (await freeModel());
      setModel(m);
      const tryOnce = async (mid: string) => {
        const res = await fetch("/api/test-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_url: OR.base, api_key: apiKey.trim(), model: mid }),
        });
        return { res, data: await res.json().catch(() => ({})) };
      };
      let { res, data } = await tryOnce(m);
      if (!res.ok || !data.ok) {
        m = await freeModel();
        ({ res, data } = await tryOnce(m));
        if (!res.ok || !data.ok) {
          setErr(String(data.error || "Key failed — check openrouter.ai/keys"));
          setConnected(false);
          return;
        }
        setModel(m);
      }
      setConnected(true);
      say("Provider connected");
      setTab("tasks");
    } catch (e: any) {
      setErr(e?.message || "Connect failed");
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }

  async function saveTask() {
    if (!work.trim()) return say("Write what to build first");
    setBusy(true);
    setErr(null);
    try {
      let pid = projectId;
      if (!pid) {
        const res = await fetch(bridge("api/v1/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: projectName.trim() || "My project",
            description: work.trim().slice(0, 400),
            rules: rules.trim() || "Prefer simple correct solutions.",
          }),
        });
        if (!res.ok) throw new Error((await res.text()).slice(0, 100));
        const p = await res.json();
        pid = p.id;
        setProjectId(pid);
      }
      const tres = await fetch(bridge("api/v1/task"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: work.trim().slice(0, 80),
          description: work.trim(),
          instructions: rules.trim(),
          project_id: pid,
          expected_version: state?.version,
        }),
      });
      if (!tres.ok) {
        if (tres.status === 409) throw new Error("Updated elsewhere — Refresh and try again");
        throw new Error((await tres.text()).slice(0, 120));
      }
      await refresh();
      say("Task saved");
      setTab("agents");
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAgents() {
    if (!apiKey.trim()) {
      say("Add provider key first");
      setTab("providers");
      return;
    }
    if (!work.trim()) {
      say("Add a task first");
      setTab("tasks");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const runModel = model.trim() || (await freeModel());
      setModel(runModel);
      setConnected(true);
      const providers = [
        {
          id: "openrouter",
          name: "OpenRouter",
          base_url: OR.base,
          model: runModel,
          api_key: apiKey.trim(),
          enabled: true,
        },
      ];
      const assigned = autoAssignAgents(
        agents,
        providers.map((p) => ({
          id: p.id,
          name: p.name,
          enabled: true,
          api_key: p.api_key,
          base_url: p.base_url,
          models: [{ id: p.model, tags: ["code", "general"] }],
        })),
        work
      );
      setAgents(assigned);
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers,
          agents: assigned,
          mode: "sequential",
          project_id: projectId || state?.project_id,
          auto_assign: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Run failed");
      const ok = (data.results || []).filter((r: any) => r.ok).length;
      const fail = (data.results || []).filter((r: any) => !r.ok);
      if (ok === 0 && fail[0]) setErr(fail[0].detail || "Agents failed");
      else say(`${ok} agent(s) finished`);
      await refresh();
      setTab("activity");
    } catch (e: any) {
      setErr(e?.message || "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={shell}>
      <header style={topBar}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Multi-AI Bridge</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {connected ? "Provider ready" : "No provider yet"}
          </div>
        </div>
        <button type="button" style={linkBtn} onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </header>

      {msg && <div style={toastOk}>{msg}</div>}
      {err && <div style={toastErr}>{err}</div>}

      <main style={main}>
        {tab === "overview" && (
          <section>
            <h1 style={title}>Overview</h1>
            <div style={card}>
              <Row label="Provider" value={connected ? "Connected" : "Not connected"} />
              <Row label="Model" value={model || "—"} />
              <Row label="Project" value={projectName || "—"} />
              <Row label="Current task" value={state?.task_title || work.slice(0, 60) || "None"} />
              <Row label="Agents" value={`${agents.length} roles`} />
              <Row label="Activity" value={`${history.length} entries`} />
            </div>
            <button type="button" style={primary} onClick={runAgents} disabled={busy}>
              {busy ? "Running…" : "Run agents"}
            </button>
            <p style={hint}>Need a key? Open Providers. Need work? Open Tasks.</p>
          </section>
        )}

        {tab === "tasks" && (
          <section>
            <h1 style={title}>Tasks</h1>
            <p style={hint}>Describe what the agents should build.</p>
            <label style={lab}>Project name</label>
            <input style={inp} value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="My project" />
            <label style={lab}>What to do</label>
            <textarea
              style={{ ...inp, minHeight: 110 }}
              value={work}
              onChange={(e) => setWork(e.target.value)}
              placeholder="Example: Build a Python number guessing game with a README"
            />
            <label style={lab}>Rules (optional)</label>
            <textarea
              style={{ ...inp, minHeight: 56 }}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Keep it simple"
            />
            <button type="button" style={primary} onClick={saveTask} disabled={busy}>
              {busy ? "Saving…" : "Save task"}
            </button>
          </section>
        )}

        {tab === "agents" && (
          <section>
            <h1 style={title}>Agents</h1>
            {!connected && <p style={empty}>No provider connected yet. Open Providers to add a key.</p>}
            {connected && agents.length === 0 && <p style={empty}>No agents yet.</p>}
            {agents.map((a) => (
              <div key={a.id} style={agentCard}>
                <div style={{ fontWeight: 600 }}>{a.role}</div>
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                  {a.model || model || "auto model"} · {connected ? "ready" : "waiting"}
                </div>
              </div>
            ))}
            <button type="button" style={{ ...primary, marginTop: 12 }} onClick={runAgents} disabled={busy}>
              {busy ? "Running…" : "Run all agents"}
            </button>
          </section>
        )}

        {tab === "activity" && (
          <section>
            <h1 style={title}>Activity</h1>
            {history.length === 0 && <p style={empty}>No activity yet. Run agents from Overview or Agents.</p>}
            {history.slice(0, 20).map((h) => (
              <article key={h.id} style={agentCard}>
                <div style={{ fontWeight: 600, color: "#2563eb", fontSize: 13 }}>{h.role || h.agent_name}</div>
                <pre style={body}>{String(h.content || "").slice(0, 1800)}</pre>
              </article>
            ))}
          </section>
        )}

        {tab === "providers" && (
          <section>
            <h1 style={title}>Providers</h1>
            <p style={hint}>
              Add one OpenRouter key. Free models are picked automatically.{" "}
              <a href={OR.keys} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                Get a key
              </a>
            </p>
            <label style={lab}>API key</label>
            <input
              style={inp}
              type="password"
              placeholder="sk-or-v1-…"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setConnected(false);
              }}
            />
            <label style={lab}>Model (optional — leave blank for free auto)</label>
            <input style={inp} placeholder="auto" value={model} onChange={(e) => setModel(e.target.value)} />
            <button type="button" style={primary} onClick={connect} disabled={busy}>
              {busy ? "Checking…" : connected ? "Connected ✓" : "Connect"}
            </button>
            {connected && (
              <p style={{ ...hint, color: "#059669", marginTop: 12 }}>Ready. Go to Tasks or Overview to run.</p>
            )}
          </section>
        )}
      </main>

      <nav style={bottomNav}>
        {(
          [
            ["overview", "Overview"],
            ["tasks", "Tasks"],
            ["agents", "Agents"],
            ["activity", "Activity"],
            ["providers", "Providers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            style={{
              ...navItem,
              color: tab === id ? "#111" : "#9ca3af",
              fontWeight: tab === id ? 700 : 500,
            }}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ color: "#6b7280", fontSize: 14 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

/* Clean light mobile UI */
const shell: CSSProperties = {
  minHeight: "100vh",
  background: "#fff",
  color: "#111",
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  display: "flex",
  flexDirection: "column",
  maxWidth: 480,
  margin: "0 auto",
};
const topBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  borderBottom: "1px solid #eee",
  position: "sticky",
  top: 0,
  background: "#fff",
  zIndex: 5,
};
const main: CSSProperties = { flex: 1, padding: "16px 16px 88px", overflowY: "auto" };
const title: CSSProperties = { margin: "0 0 12px", fontSize: 22, fontWeight: 700 };
const card: CSSProperties = {
  background: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: "4px 14px",
  marginBottom: 16,
};
const agentCard: CSSProperties = {
  background: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 14,
  marginBottom: 10,
};
const primary: CSSProperties = {
  width: "100%",
  padding: "14px",
  borderRadius: 12,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};
const linkBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#2563eb",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const lab: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" };
const inp: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 12,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#111",
  fontSize: 15,
};
const hint: CSSProperties = { fontSize: 13, color: "#6b7280", margin: "10px 0 14px", lineHeight: 1.4 };
const empty: CSSProperties = { color: "#9ca3af", fontSize: 15, marginTop: 24, textAlign: "center" };
const body: CSSProperties = {
  margin: "8px 0 0",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#374151",
  lineHeight: 1.45,
};
const toastOk: CSSProperties = {
  margin: "8px 16px 0",
  padding: 12,
  borderRadius: 10,
  background: "#ecfdf5",
  color: "#065f46",
  fontSize: 14,
};
const toastErr: CSSProperties = {
  margin: "8px 16px 0",
  padding: 12,
  borderRadius: 10,
  background: "#fef2f2",
  color: "#991b1b",
  fontSize: 14,
};
const bottomNav: CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: "50%",
  transform: "translateX(-50%)",
  width: "100%",
  maxWidth: 480,
  display: "flex",
  borderTop: "1px solid #eee",
  background: "#fff",
  padding: "6px 0 calc(6px + env(safe-area-inset-bottom))",
  zIndex: 10,
};
const navItem: CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  padding: "10px 2px",
  fontSize: 11,
  cursor: "pointer",
};
