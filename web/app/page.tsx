"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";
import { ProjectPanel } from "./project-panel";

type State = {
  project_id?: string;
  task_title?: string;
  task_description?: string;
  instructions?: string;
  current_status?: string;
  version?: number;
};
type Contribution = { id: string; agent_name: string; role: string; content: string };
type Provider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  enabled: boolean;
  last_ok?: boolean;
  last_test?: string;
};
type ModelInfo = { id: string; tags?: string[] };

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS_P = "mab_providers_v3";
const LS_A = "mab_agents_v3";

const GATEWAYS = [
  { id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_url: "https://openrouter.ai/keys" },
  { id: "groq", name: "Groq", base_url: "https://api.groq.com/openai/v1", key_url: "https://console.groq.com/keys" },
  { id: "deepseek", name: "DeepSeek", base_url: "https://api.deepseek.com/v1", key_url: "https://platform.deepseek.com/api_keys" },
  { id: "google", name: "Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", key_url: "https://aistudio.google.com/apikey" },
] as const;

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>(DEFAULT_AGENTS);
  const [projectId, setProjectId] = useState("");
  const [selectedGw, setSelectedGw] = useState("openrouter");
  const [keyDraft, setKeyDraft] = useState("");
  const [freeRecs, setFreeRecs] = useState<ModelInfo[]>([]);
  const [prefer, setPrefer] = useState<"code" | "analysis" | "balanced">("code");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [runMode, setRunMode] = useState<"sequential" | "parallel">("sequential");
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [newRole, setNewRole] = useState("");

  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_P);
      const a = localStorage.getItem(LS_A);
      if (p) setProviders(JSON.parse(p));
      if (a) setAgents(JSON.parse(a));
    } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_P, JSON.stringify(providers)); } catch { /* */ }
  }, [providers]);
  useEffect(() => {
    try { localStorage.setItem(LS_A, JSON.stringify(agents)); } catch { /* */ }
  }, [agents]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(bridge("api/v1/state")), fetch(bridge("api/v1/history"))]);
      if (!s.ok) throw new Error((await s.text()).slice(0, 160));
      const st = await s.json();
      setState(st);
      if (st.project_id) setProjectId(st.project_id);
      if (h.ok) {
        const j = await h.json();
        setHistory(Array.isArray(j) ? j : []);
      }
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backend offline");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 12000);
    return () => clearInterval(t);
  }, [refresh]);

  async function loadFree() {
    try {
      const res = await fetch(`/api/recommend-free?prefer=${prefer}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setFreeRecs(data.recommended || []);
    } catch { /* */ }
  }
  useEffect(() => {
    if (step === 1) loadFree();
  }, [step, prefer]);

  function upsertProvider(partial: Partial<Provider> & { id: string; name: string; base_url: string }) {
    setProviders((prev) => {
      const ex = prev.find((p) => p.id === partial.id);
      const next: Provider = {
        id: partial.id,
        name: partial.name,
        base_url: partial.base_url,
        model: partial.model ?? ex?.model ?? "",
        api_key: partial.api_key ?? ex?.api_key ?? "",
        enabled: true,
        last_ok: partial.last_ok ?? ex?.last_ok,
        last_test: partial.last_test ?? ex?.last_test,
      };
      if (ex) return prev.map((p) => (p.id === partial.id ? next : p));
      return [...prev, next];
    });
  }

  async function saveAndTest() {
    const gw = GATEWAYS.find((g) => g.id === selectedGw)!;
    if (!keyDraft.trim()) return flash("Paste API key");
    const model = freeRecs[0]?.id || "";
    upsertProvider({ id: gw.id, name: gw.id, base_url: gw.base_url, api_key: keyDraft.trim(), model });
    setTesting(true);
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: gw.base_url, model: model || "openrouter/free", api_key: keyDraft.trim() }),
      });
      const data = await res.json();
      upsertProvider({
        id: gw.id,
        name: gw.id,
        base_url: gw.base_url,
        last_ok: !!data.ok,
        last_test: data.ok ? "Connected" : String(data.error || "failed").slice(0, 80),
      });
      flash(data.ok ? "Provider connected" : String(data.error || "failed"));
      if (data.ok) setStep(2);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function publishTask() {
    if (!title.trim()) return flash("Title required");
    const res = await fetch(bridge("api/v1/task"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        project_id: projectId || undefined,
        goals: [],
        constraints: [],
      }),
    });
    if (!res.ok) return flash((await res.text()).slice(0, 120));
    flash("Task saved");
    await refresh();
    setStep(4);
  }

  function autoAssign() {
    const enabled = providers.filter((p) => p.enabled && p.api_key);
    if (!enabled.length) return flash("Connect provider first");
    setAgents(
      autoAssignAgents(
        agents,
        enabled.map((p) => ({
          id: p.id,
          name: p.name,
          enabled: true,
          api_key: p.api_key,
          base_url: p.base_url,
          models: p.model ? [{ id: p.model, tags: ["code", "general"] }] : freeRecs,
        })),
        [title, description, instructions].join(" ") || "coding"
      )
    );
    flash("Assigned");
  }

  async function runAgents() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: runMode,
          auto_assign: true,
          project_id: projectId || undefined,
          providers: providers.map((p) => ({
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            api_key: p.api_key,
            base_url: p.base_url,
            models: p.model ? [{ id: p.model, tags: ["general"] }] : [],
          })),
          agents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
      const ok = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      flash(`Done · ${ok} ok · project context: ${data.used_project_context ? "yes" : "no"}`);
      if (data.history) setHistory(data.history);
      else await refresh();
      setStep(5);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const active = providers.find((p) => p.enabled && p.api_key);
  const steps = [
    { n: 1 as const, label: "Setup" },
    { n: 2 as const, label: "Project" },
    { n: 3 as const, label: "Task" },
    { n: 4 as const, label: "Agents" },
    { n: 5 as const, label: "Run" },
  ];

  return (
    <main style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>Multi-AI Bridge</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8b929e" }}>
            {active ? <span style={{ color: "#6ee7b7" }}>● {active.name}</span> : <span style={{ color: "#fca5a5" }}>○ no provider</span>}
            {" · "}
            {projectId ? `project ${projectId.slice(0, 10)}…` : "no project"}
            {" · "}
            {state?.task_title || "no task"}
          </p>
        </div>
        <button type="button" style={ghost} onClick={() => refresh()}>Sync</button>
      </header>

      <nav style={stepNav}>
        {steps.map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => setStep(s.n)}
            style={{ ...stepBtn, background: step === s.n ? "#2563eb" : "transparent", color: step === s.n ? "#fff" : "#9aa0a6" }}
          >
            {s.n}. {s.label}
          </button>
        ))}
      </nav>

      {toast && <div style={toastBox}>{toast}</div>}
      {error && <div style={errBox}>{error}</div>}

      {step === 1 && (
        <section style={card}>
          <h2 style={h2}>1. Connect provider</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {GATEWAYS.map((g) => (
              <button key={g.id} type="button" style={{ ...chip, borderColor: selectedGw === g.id ? "#3b82f6" : "#2a2e35" }} onClick={() => setSelectedGw(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
          <input style={input} type="password" placeholder="API key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["code", "analysis", "balanced"] as const).map((p) => (
              <button key={p} type="button" style={prefer === p ? chipOn : chip} onClick={() => setPrefer(p)}>{p}</button>
            ))}
          </div>
          <div style={listBox}>
            {freeRecs.slice(0, 8).map((m, i) => (
              <button key={m.id} type="button" style={listRow} onClick={() => {
                const gw = GATEWAYS.find((g) => g.id === selectedGw)!;
                upsertProvider({ id: gw.id, name: gw.id, base_url: gw.base_url, model: m.id });
                flash(`Model ${m.id}`);
              }}>
                <span style={{ color: "#6ee7b7" }}>#{i + 1}</span> {m.id}
              </button>
            ))}
          </div>
          <button type="button" style={primary} disabled={testing} onClick={saveAndTest}>
            {testing ? "Testing…" : "Save & test"}
          </button>
          <button type="button" style={{ ...ghost, width: "100%", marginTop: 8 }} onClick={() => setStep(2)}>Next: Project →</button>
        </section>
      )}

      {step === 2 && (
        <section style={card}>
          <h2 style={h2}>2. Project + training data</h2>
          <ProjectPanel projectId={projectId} onProjectId={setProjectId} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" style={ghost} onClick={() => setStep(1)}>← Setup</button>
            <button type="button" style={primary} onClick={() => setStep(3)}>Next: Task →</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section style={card}>
          <h2 style={h2}>3. Task (this unit of work)</h2>
          <p style={help}>Task rules are for this job only. Project rules + knowledge always apply too.</p>
          <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...input, minHeight: 56 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea style={{ ...input, minHeight: 56 }} placeholder="Task rules / instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <button type="button" style={primary} onClick={publishTask}>Save task</button>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" style={ghost} onClick={() => setStep(2)}>← Project</button>
            <button type="button" style={primary} onClick={() => setStep(4)}>Next: Agents →</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section style={card}>
          <h2 style={h2}>4. Agents</h2>
          <button type="button" style={{ ...primary, background: "#7c3aed" }} onClick={autoAssign}>Auto-assign models</button>
          {agents.map((a) => (
            <div key={a.id} style={{ ...listBox, padding: 10, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{a.role}</strong>
                <button type="button" style={danger} onClick={() => setAgents((prev) => prev.filter((x) => x.id !== a.id))}>
                  Delete
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#9aa0a6" }}>
                {a.provider_id && a.model ? `${a.provider_id} → ${a.model}` : "auto on run"}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input style={{ ...input, marginBottom: 0 }} placeholder="New role" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
            <button type="button" style={ghost} onClick={() => {
              const role = newRole.trim() || `Agent ${agents.length + 1}`;
              setAgents((prev) => [...prev, { id: role.toLowerCase().replace(/\s+/g, "-") + Date.now().toString(36).slice(-3), role }]);
              setNewRole("");
            }}>Add</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" style={ghost} onClick={() => setStep(3)}>← Task</button>
            <button type="button" style={primary} onClick={() => setStep(5)}>Next: Run →</button>
          </div>
        </section>
      )}

      {step === 5 && (
        <>
          <section style={card}>
            <h2 style={h2}>5. Run</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button type="button" style={runMode === "sequential" ? chipOn : chip} onClick={() => setRunMode("sequential")}>Sequential</button>
              <button type="button" style={runMode === "parallel" ? chipOn : chip} onClick={() => setRunMode("parallel")}>Parallel</button>
            </div>
            <p style={help}>Agents receive project knowledge + project rules + task rules automatically.</p>
            <button type="button" style={{ ...primary, background: running ? "#374151" : "#059669" }} disabled={running} onClick={runAgents}>
              {running ? "Running…" : "▶ Run agents"}
            </button>
          </section>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Activity</h2>
            {!history.length ? <p style={help}>Empty</p> : history.map((c) => (
              <div key={c.id} style={{ ...listBox, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#9aa0a6" }}><strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role}</div>
                <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>{c.content}</pre>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

const page: CSSProperties = { fontFamily: "system-ui,sans-serif", padding: "12px 12px 40px", maxWidth: 560, margin: "0 auto", background: "#0b0d12", color: "#e8eaed", minHeight: "100vh" };
const header: CSSProperties = { display: "flex", justifyContent: "space-between", marginBottom: 12 };
const stepNav: CSSProperties = { display: "flex", gap: 4, marginBottom: 14, background: "#14171e", borderRadius: 12, padding: 4, border: "1px solid #252a35", flexWrap: "wrap" };
const stepBtn: CSSProperties = { flex: 1, border: "none", borderRadius: 9, padding: "8px 4px", fontSize: 11, fontWeight: 600, cursor: "pointer", minWidth: 56 };
const card: CSSProperties = { background: "#14171e", border: "1px solid #252a35", borderRadius: 14, padding: 14 };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 15, fontWeight: 700 };
const help: CSSProperties = { margin: "0 0 10px", fontSize: 12, color: "#9aa0a6", lineHeight: 1.4 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid #2a2e35", background: "#0b0d12", color: "#e8eaed", fontSize: 14 };
const primary: CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" };
const ghost: CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #2a2e35", background: "#0b0d12", color: "#c5cae0", fontWeight: 600, cursor: "pointer" };
const danger: CSSProperties = { padding: "4px 8px", borderRadius: 8, border: "none", background: "#7f1d1d", color: "#fecaca", fontSize: 12, cursor: "pointer" };
const chip: CSSProperties = { padding: "8px 12px", borderRadius: 20, border: "1px solid #2a2e35", background: "#0b0d12", color: "#c5cae0", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const chipOn: CSSProperties = { ...chip, background: "#1e3a5f", borderColor: "#3b82f6", color: "#fff" };
const listBox: CSSProperties = { background: "#0b0d12", border: "1px solid #252a35", borderRadius: 10, overflow: "hidden", marginBottom: 10 };
const listRow: CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", borderBottom: "1px solid #1a1d24", background: "transparent", color: "#e8eaed", fontSize: 12, cursor: "pointer" };
const toastBox: CSSProperties = { background: "#064e3b", color: "#a7f3d0", padding: "10px 12px", borderRadius: 10, marginBottom: 10, fontSize: 13 };
const errBox: CSSProperties = { background: "#2a1215", border: "1px solid #7f1d1d", padding: 12, borderRadius: 12, marginBottom: 10, fontSize: 13 };
