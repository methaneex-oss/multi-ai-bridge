"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";
import { ProjectPanel } from "./project-panel";
import { EngineeringPanel } from "./engineering-panel";

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

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(bridge("api/v1/state")), fetch(bridge("api/v1/history"))]);
      if (s.ok) {
        const st = await s.json();
        setState(st);
        if (st.project_id && !projectId) setProjectId(st.project_id);
      }
      if (h.ok) setHistory(await h.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Backend unreachable");
    }
  }, [projectId]);

  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_P);
      if (p) setProviders(JSON.parse(p));
      const a = localStorage.getItem(LS_A);
      if (a) setAgents(JSON.parse(a));
    } catch {
      /* */
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem(LS_P, JSON.stringify(providers));
  }, [providers]);
  useEffect(() => {
    localStorage.setItem(LS_A, JSON.stringify(agents));
  }, [agents]);

  async function loadFree() {
    try {
      const res = await fetch(`/api/recommend-free?prefer=${prefer}`, { cache: "no-store" });
      const data = await res.json();
      setFreeRecs(Array.isArray(data.models) ? data.models : []);
    } catch {
      setFreeRecs([]);
    }
  }

  useEffect(() => {
    if (step === 1) loadFree();
  }, [step, prefer]);

  function addProvider() {
    const gw = GATEWAYS.find((g) => g.id === selectedGw) || GATEWAYS[0];
    if (!keyDraft.trim()) return flash("API key required");
    const model = freeRecs[0]?.id || "";
    setProviders((prev) => [
      ...prev.filter((p) => p.id !== gw.id),
      {
        id: gw.id,
        name: gw.name,
        base_url: gw.base_url,
        model,
        api_key: keyDraft.trim(),
        enabled: true,
      },
    ]);
    setKeyDraft("");
    flash(`${gw.name} added`);
  }

  async function testProvider(p: Provider) {
    setTesting(true);
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: p.base_url, api_key: p.api_key, model: p.model }),
      });
      const data = await res.json();
      const ok = !!data.ok;
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, last_ok: ok, last_test: ok ? "ok" : data.error || "fail" } : x))
      );
      flash(ok ? `${p.name} OK` : `${p.name}: ${data.error || "fail"}`);
    } catch (e) {
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
        expected_version: state?.version,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 409) return flash("Version conflict — refresh and retry");
      return flash(t.slice(0, 160));
    }
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
    try {
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers,
          agents,
          mode: runMode,
          project_id: projectId || state?.project_id,
          auto_assign: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "run failed");
      flash(`Run done: ${(data.results || []).filter((r: any) => r.ok).length} ok`);
      await refresh();
    } catch (e: any) {
      flash(e?.message || "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const steps = [
    { n: 1 as const, label: "Setup" },
    { n: 2 as const, label: "Project" },
    { n: 3 as const, label: "Task" },
    { n: 4 as const, label: "Agents" },
    { n: 5 as const, label: "Run" },
  ];

  return (
    <main style={page}>
      <div style={header}>
        <div>
          <strong>Multi-AI Bridge</strong>
          <div style={{ fontSize: 12, color: "#9aa0a6" }}>Handbook-aligned coordination</div>
        </div>
        <button type="button" style={ghost} onClick={refresh}>
          Refresh
        </button>
      </div>
      {toast && <div style={toastBox}>{toast}</div>}
      {error && <div style={errBox}>{error}</div>}
      <div style={stepNav}>
        {steps.map((s) => (
          <button
            key={s.n}
            type="button"
            style={{ ...stepBtn, background: step === s.n ? "#2563eb" : "transparent", color: step === s.n ? "#fff" : "#9aa0a6" }}
            onClick={() => setStep(s.n)}
          >
            {s.n}. {s.label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div style={card}>
          <h2 style={h2}>1. Providers</h2>
          <p style={help}>Add OpenAI-compatible keys (OpenRouter recommended for free models).</p>
          <select style={input} value={selectedGw} onChange={(e) => setSelectedGw(e.target.value)}>
            {GATEWAYS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input style={input} type="password" placeholder="API key" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
          <button type="button" style={primary} onClick={addProvider}>
            Add provider
          </button>
          <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
            {(["code", "analysis", "balanced"] as const).map((x) => (
              <button key={x} type="button" style={prefer === x ? chipOn : chip} onClick={() => setPrefer(x)}>
                {x}
              </button>
            ))}
          </div>
          {providers.map((p) => (
            <div key={p.id} style={{ ...listRow, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                {p.name} {p.last_ok === true ? "✓" : p.last_ok === false ? "✗" : ""}
              </span>
              <span>
                <button type="button" style={ghost} disabled={testing} onClick={() => testProvider(p)}>
                  Test
                </button>{" "}
                <button type="button" style={danger} onClick={() => setProviders((prev) => prev.filter((x) => x.id !== p.id))}>
                  Del
                </button>
              </span>
            </div>
          ))}
          <button type="button" style={{ ...primary, marginTop: 10 }} onClick={() => setStep(2)}>
            Next: Project →
          </button>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <h2 style={h2}>2. Project</h2>
          <ProjectPanel projectId={projectId} onProjectId={setProjectId} />
          <button type="button" style={{ ...primary, marginTop: 10 }} onClick={() => setStep(3)}>
            Next: Task →
          </button>
        </div>
      )}

      {step === 3 && (
        <div style={card}>
          <h2 style={h2}>3. Task (this unit of work)</h2>
          <p style={help}>Task rules are for this job only. Project rules + knowledge always apply too.</p>
          <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea style={{ ...input, minHeight: 56 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <textarea style={{ ...input, minHeight: 56 }} placeholder="Task rules / instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <button type="button" style={primary} onClick={publishTask}>
            Save task
          </button>
          <EngineeringPanel projectId={projectId} />
        </div>
      )}

      {step === 4 && (
        <div style={card}>
          <h2 style={h2}>4. Agents</h2>
          <button type="button" style={primary} onClick={autoAssign}>
            Auto-assign from providers
          </button>
          <div style={listBox}>
            {agents.map((a) => (
              <div key={a.id} style={listRow}>
                {a.role} → {a.provider_id || "?"} / {a.model || "default"}
              </div>
            ))}
          </div>
          <input style={input} placeholder="Add role name" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
          <button
            type="button"
            style={ghost}
            onClick={() => {
              if (!newRole.trim()) return;
              setAgents((prev) => [...prev, { id: newRole.trim().toLowerCase().replace(/\s+/g, "-"), role: newRole.trim() }]);
              setNewRole("");
            }}
          >
            Add agent role
          </button>
          <button type="button" style={{ ...primary, marginTop: 10 }} onClick={() => setStep(5)}>
            Next: Run →
          </button>
        </div>
      )}

      {step === 5 && (
        <div style={card}>
          <h2 style={h2}>5. Run</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button type="button" style={runMode === "sequential" ? chipOn : chip} onClick={() => setRunMode("sequential")}>
              sequential
            </button>
            <button type="button" style={runMode === "parallel" ? chipOn : chip} onClick={() => setRunMode("parallel")}>
              parallel
            </button>
          </div>
          <button type="button" style={primary} disabled={running} onClick={runAgents}>
            {running ? "Running…" : "Run agents"}
          </button>
          <button type="button" style={{ ...ghost, marginTop: 8 }} onClick={() => setStep(3)}>
            ← Task
          </button>
          <h3 style={{ ...h2, marginTop: 16 }}>History</h3>
          <div style={listBox}>
            {history.slice(0, 12).map((h) => (
              <div key={h.id} style={listRow}>
                <b>[{h.role}]</b> {String(h.content || "").slice(0, 200)}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

const page: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, fontFamily: "system-ui,sans-serif", background: "#0b0d12", color: "#e8eaed", minHeight: "100vh" };
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
