"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";

type State = {
  task_title?: string;
  task_description?: string;
  instructions?: string;
  current_status?: string;
  goals?: string[];
  version?: number;
};

type Contribution = {
  id: string;
  agent_name: string;
  role: string;
  content: string;
  contribution_type: string;
};

type ModelInfo = { id: string; name?: string; tags?: string[]; free?: boolean; context?: number | null };

type Provider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  enabled: boolean;
  models?: ModelInfo[];
  last_test?: string;
  last_ok?: boolean;
};

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS_P = "mab_providers_v3";
const LS_A = "mab_agents_v3";

const GATEWAYS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    free: true,
    key_url: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    name: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    free: true,
    key_url: "https://console.groq.com/keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    free: false,
    key_url: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "google",
    name: "Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    free: true,
    key_url: "https://aistudio.google.com/apikey",
  },
] as const;

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<"sequential" | "parallel">("sequential");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>(DEFAULT_AGENTS);
  const [keyDraft, setKeyDraft] = useState("");
  const [selectedGw, setSelectedGw] = useState<string>("openrouter");
  const [freeRecs, setFreeRecs] = useState<ModelInfo[]>([]);
  const [prefer, setPrefer] = useState<"balanced" | "code" | "analysis">("code");
  const [loadingFree, setLoadingFree] = useState(false);
  const [testing, setTesting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("");

  const [artifacts, setArtifacts] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [jobCmd, setJobCmd] = useState("");
  const [jobs, setJobs] = useState<{ id: string; status: string; command: string; output?: string }[]>([]);

  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_P);
      const a = localStorage.getItem(LS_A);
      if (p) setProviders(JSON.parse(p));
      if (a) setAgents(JSON.parse(a));
    } catch {
      /* */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_P, JSON.stringify(providers));
    } catch {
      /* */
    }
  }, [providers]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_A, JSON.stringify(agents));
    } catch {
      /* */
    }
  }, [agents]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(bridge("api/v1/state")), fetch(bridge("api/v1/history"))]);
      if (!s.ok) throw new Error((await s.text()).slice(0, 180));
      setState(await s.json());
      if (h.ok) {
        const j = await h.json();
        setHistory(Array.isArray(j) ? j : []);
      }
      setError(null);
      // optional artifacts / jobs if API supports
      try {
        const ar = await fetch(bridge("api/v1/artifacts"));
        if (ar.ok) {
          const d = await ar.json();
          setArtifacts(Array.isArray(d) ? d : d.artifacts || []);
        }
      } catch {
        /* */
      }
      try {
        const jr = await fetch(bridge("api/v1/jobs"));
        if (jr.ok) {
          const d = await jr.json();
          setJobs(Array.isArray(d) ? d : d.jobs || []);
        }
      } catch {
        /* */
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Backend offline");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  async function loadFree(pref = prefer) {
    setLoadingFree(true);
    try {
      const res = await fetch(`/api/recommend-free?prefer=${pref}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "catalog failed");
      setFreeRecs(data.recommended || []);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Free models failed");
    } finally {
      setLoadingFree(false);
    }
  }

  useEffect(() => {
    if (step === 1) loadFree(prefer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        enabled: partial.enabled ?? ex?.enabled ?? true,
        models: partial.models ?? ex?.models,
        last_test: partial.last_test ?? ex?.last_test,
        last_ok: partial.last_ok ?? ex?.last_ok,
      };
      if (ex) return prev.map((p) => (p.id === partial.id ? next : p));
      return [...prev, next];
    });
  }

  async function saveAndTest() {
    const gw = GATEWAYS.find((g) => g.id === selectedGw) || GATEWAYS[0];
    if (!keyDraft.trim()) {
      flash("Paste an API key first");
      return;
    }
    const model = freeRecs[0]?.id || "";
    upsertProvider({
      id: gw.id,
      name: gw.id,
      base_url: gw.base_url,
      api_key: keyDraft.trim(),
      model,
      enabled: true,
    });
    setTesting(true);
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: gw.base_url,
          model: model || "openrouter/free",
          api_key: keyDraft.trim(),
        }),
      });
      const data = await res.json();
      upsertProvider({
        id: gw.id,
        name: gw.id,
        base_url: gw.base_url,
        last_ok: !!data.ok,
        last_test: data.ok ? "Connected" : String(data.error || "failed").slice(0, 80),
      });
      flash(data.ok ? "Provider connected" : String(data.error || "Test failed"));
      if (data.ok) setStep(2);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  function pickFreeModel(id: string) {
    const gw = GATEWAYS.find((g) => g.id === selectedGw) || GATEWAYS[0];
    upsertProvider({ id: gw.id, name: gw.id, base_url: gw.base_url, model: id });
    flash(`Model: ${id}`);
  }

  function deleteProvider(id: string) {
    if (!confirm(`Remove provider ${id}?`)) return;
    setProviders((prev) => prev.filter((p) => p.id !== id));
    setAgents((prev) =>
      prev.map((a) => (a.provider_id === id ? { ...a, provider_id: undefined, model: undefined } : a))
    );
    flash(`Removed ${id}`);
  }

  async function publishTask() {
    if (!title.trim()) {
      flash("Task title required");
      return;
    }
    try {
      const res = await fetch(bridge("api/v1/task"), {
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
      if (!res.ok) throw new Error((await res.text()).slice(0, 160));
      flash("Task saved");
      await refresh();
      setStep(3);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function clearTask() {
    if (!confirm("Clear current task on the server?")) return;
    try {
      const res = await fetch(bridge("api/v1/task"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "",
          description: "",
          instructions: "",
          goals: [],
          constraints: [],
        }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 120));
      setTitle("");
      setDescription("");
      setInstructions("");
      flash("Task cleared");
      await refresh();
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Clear failed");
    }
  }

  function addAgent() {
    const role = newAgentRole.trim() || `Agent ${agents.length + 1}`;
    const id = role.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36).slice(-4);
    setAgents((prev) => [...prev, { id, role, capabilities: ["general"] }]);
    setNewAgentRole("");
  }

  function removeAgent(id: string) {
    if (agents.length <= 1) {
      flash("Keep at least one agent");
      return;
    }
    if (!confirm("Remove this agent?")) return;
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }

  function autoAssign() {
    const enabled = providers.filter((p) => p.enabled && p.api_key);
    if (!enabled.length) {
      flash("Connect a provider in Setup first");
      setStep(1);
      return;
    }
    const ctx = [title, description, instructions, state?.task_title, state?.task_description]
      .filter(Boolean)
      .join(" ");
    setAgents(
      autoAssignAgents(
        agents,
        enabled.map((p) => ({
          id: p.id,
          name: p.name,
          enabled: true,
          api_key: p.api_key,
          base_url: p.base_url,
          models: p.model ? [{ id: p.model, tags: ["code", "reasoning", "general"] }] : freeRecs,
        })),
        ctx || "coding analysis"
      )
    );
    flash("Agents assigned");
  }

  async function runAgents() {
    const enabled = providers.filter((p) => p.enabled && p.api_key);
    if (!enabled.length) {
      flash("Connect a provider first");
      setStep(1);
      return;
    }
    if (!state?.task_title && !title.trim()) {
      flash("Set a task first");
      setStep(2);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: runMode,
          auto_assign: true,
          providers: providers.map((p) => ({
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            api_key: p.api_key,
            base_url: p.base_url,
            models: p.model ? [{ id: p.model, tags: ["general", "code"] }] : p.models || [],
          })),
          agents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Run failed (${res.status})`);
      if (data.assignments) {
        setAgents((prev) =>
          prev.map((a) => {
            const m = data.assignments.find((x: { id: string }) => x.id === a.id);
            return m ? { ...a, provider_id: m.provider_id, model: m.model } : a;
          })
        );
      }
      const ok = (data.results || []).filter((r: { ok: boolean }) => r.ok).length;
      const fail = (data.results || []).length - ok;
      flash(`Run done · ${ok} ok${fail ? ` · ${fail} failed` : ""}`);
      if (data.history) setHistory(data.history);
      else await refresh();
      setStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function enqueueJob() {
    if (!jobCmd.trim()) return;
    try {
      const res = await fetch(bridge("api/v1/jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "shell", command: jobCmd.trim(), project_id: state?.task_title || "default" }),
      });
      if (!res.ok) {
        flash("Jobs API not available on this backend yet — task sync still works");
        return;
      }
      flash("Job queued");
      setJobCmd("");
      await refresh();
    } catch {
      flash("Jobs endpoint unavailable");
    }
  }

  const activeProvider = providers.find((p) => p.enabled && p.api_key);
  const steps = [
    { n: 1 as const, label: "Setup" },
    { n: 2 as const, label: "Task" },
    { n: 3 as const, label: "Agents" },
    { n: 4 as const, label: "Run" },
  ];

  return (
    <main style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Multi-AI Bridge</h1>
          <p style={{ margin: "2px 0 0", color: "#8b929e", fontSize: 12 }}>
            {activeProvider ? (
              <>
                <span style={{ color: "#6ee7b7" }}>●</span> {activeProvider.name}
                {activeProvider.model ? ` · ${activeProvider.model.slice(0, 36)}` : ""}
              </>
            ) : (
              <span style={{ color: "#fca5a5" }}>○ No provider connected</span>
            )}
            {" · "}
            {state?.task_title ? state.task_title : "No task"}
          </p>
        </div>
        <button type="button" style={ghostBtn} onClick={() => refresh()}>
          Sync
        </button>
      </header>

      {/* Step nav */}
      <nav style={stepNav}>
        {steps.map((s) => (
          <button
            key={s.n}
            type="button"
            onClick={() => setStep(s.n)}
            style={{
              ...stepBtn,
              background: step === s.n ? "#2563eb" : "transparent",
              color: step === s.n ? "#fff" : "#9aa0a6",
            }}
          >
            <span style={stepNum}>{s.n}</span> {s.label}
          </button>
        ))}
      </nav>

      {toast && <div style={toastBox}>{toast}</div>}
      {error && (
        <div style={errBox}>
          {error}
          <button type="button" style={{ ...ghostBtn, marginLeft: 8 }} onClick={() => refresh()}>
            Retry
          </button>
        </div>
      )}

      {/* STEP 1 — SETUP */}
      {step === 1 && (
        <section style={card}>
          <h2 style={h2}>1. Connect a provider</h2>
          <p style={help}>Pick a gateway, paste your key, choose a free model. No OpenAI required.</p>

          <div style={chipRow}>
            {GATEWAYS.map((g) => (
              <button
                key={g.id}
                type="button"
                style={{
                  ...chip,
                  borderColor: selectedGw === g.id ? "#3b82f6" : "#2a2e35",
                  background: selectedGw === g.id ? "#1e3a5f" : "#0b0d12",
                }}
                onClick={() => setSelectedGw(g.id)}
              >
                {g.name}
                {g.free ? <span style={{ color: "#6ee7b7", marginLeft: 4 }}>free</span> : null}
              </button>
            ))}
          </div>

          <label style={label}>API key</label>
          <input
            style={input}
            type="password"
            placeholder="Paste key…"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" style={primaryBtn} disabled={testing} onClick={saveAndTest}>
              {testing ? "Testing…" : "Save & test"}
            </button>
            <a
              href={GATEWAYS.find((g) => g.id === selectedGw)?.key_url}
              target="_blank"
              rel="noreferrer"
              style={{ ...ghostBtn, textDecoration: "none", lineHeight: "36px" }}
            >
              Get key
            </a>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["code", "analysis", "balanced"] as const).map((p) => (
              <button key={p} type="button" style={prefer === p ? chipOn : chip} onClick={() => setPrefer(p)}>
                {p}
              </button>
            ))}
            <button type="button" style={ghostBtn} onClick={() => loadFree(prefer)} disabled={loadingFree}>
              {loadingFree ? "…" : "Refresh free models"}
            </button>
          </div>

          <div style={listBox}>
            {freeRecs.slice(0, 10).map((m, i) => (
              <button key={m.id} type="button" style={listRow} onClick={() => pickFreeModel(m.id)}>
                <span style={{ color: "#6ee7b7", width: 22 }}>#{i + 1}</span>
                <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>{m.id}</span>
                <span style={{ color: "#6b7280", fontSize: 11 }}>{(m.tags || []).slice(0, 2).join(", ")}</span>
              </button>
            ))}
            {!freeRecs.length && <p style={help}>Loading free models…</p>}
          </div>

          {providers.length > 0 && (
            <>
              <h3 style={{ ...h2, marginTop: 16 }}>Saved providers</h3>
              {providers.map((p) => (
                <div key={p.id} style={rowBetween}>
                  <div>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 11, color: "#9aa0a6" }}>{p.model || "no model"}</div>
                    <div style={{ fontSize: 11, color: p.last_ok ? "#6ee7b7" : "#fca5a5" }}>
                      {p.last_test || "untested"}
                    </div>
                  </div>
                  <button type="button" style={dangerBtn} onClick={() => deleteProvider(p.id)}>
                    Delete
                  </button>
                </div>
              ))}
            </>
          )}

          <button type="button" style={{ ...primaryBtn, marginTop: 14 }} onClick={() => setStep(2)}>
            Next: Task →
          </button>
        </section>
      )}

      {/* STEP 2 — TASK */}
      {step === 2 && (
        <section style={card}>
          <h2 style={h2}>2. Task (shared for all agents)</h2>
          <p style={help}>One task on the server. Agents stay in sync via this state.</p>
          {state?.task_title ? (
            <div style={{ ...listBox, marginBottom: 12, padding: 10 }}>
              <div style={{ fontWeight: 600 }}>{state.task_title}</div>
              <div style={{ fontSize: 12, color: "#9aa0a6" }}>{state.task_description}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                {state.current_status} · v{state.version}
              </div>
            </div>
          ) : null}
          <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            style={{ ...input, minHeight: 56 }}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            style={{ ...input, minHeight: 56 }}
            placeholder="Rules / instructions for every agent"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={primaryBtn} onClick={publishTask}>
              Save task
            </button>
            <button type="button" style={dangerBtn} onClick={clearTask}>
              Clear task
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" style={ghostBtn} onClick={() => setStep(1)}>
              ← Setup
            </button>
            <button type="button" style={primaryBtn} onClick={() => setStep(3)}>
              Next: Agents →
            </button>
          </div>
        </section>
      )}

      {/* STEP 3 — AGENTS */}
      {step === 3 && (
        <section style={card}>
          <h2 style={h2}>3. Agents</h2>
          <p style={help}>Add or remove roles. Auto-assign picks models from your connected provider.</p>
          <button type="button" style={{ ...primaryBtn, marginBottom: 12, background: "#7c3aed" }} onClick={autoAssign}>
            Auto-assign models
          </button>
          {agents.map((a) => (
            <div key={a.id} style={{ ...listBox, marginBottom: 8, padding: 10 }}>
              <div style={rowBetween}>
                <strong>{a.role}</strong>
                <button type="button" style={dangerBtn} onClick={() => removeAgent(a.id)}>
                  Delete
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 4 }}>
                {a.provider_id && a.model ? `${a.provider_id} → ${a.model}` : "will auto-assign on run"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                <select
                  style={input}
                  value={a.provider_id || ""}
                  onChange={(e) =>
                    setAgents((prev) =>
                      prev.map((x) =>
                        x.id === a.id ? { ...x, provider_id: e.target.value || undefined } : x
                      )
                    )
                  }
                >
                  <option value="">Provider (auto)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  style={input}
                  placeholder="Model (auto)"
                  value={a.model || ""}
                  onChange={(e) =>
                    setAgents((prev) =>
                      prev.map((x) =>
                        x.id === a.id ? { ...x, model: e.target.value || undefined } : x
                      )
                    )
                  }
                />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, marginBottom: 0 }}
              placeholder="New role e.g. Tester"
              value={newAgentRole}
              onChange={(e) => setNewAgentRole(e.target.value)}
            />
            <button type="button" style={ghostBtn} onClick={addAgent}>
              Add
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" style={ghostBtn} onClick={() => setStep(2)}>
              ← Task
            </button>
            <button type="button" style={primaryBtn} onClick={() => setStep(4)}>
              Next: Run →
            </button>
          </div>
        </section>
      )}

      {/* STEP 4 — RUN + ACTIVITY + STORAGE */}
      {step === 4 && (
        <>
          <section style={card}>
            <h2 style={h2}>4. Run</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                style={runMode === "sequential" ? chipOn : chip}
                onClick={() => setRunMode("sequential")}
              >
                Sequential
              </button>
              <button
                type="button"
                style={runMode === "parallel" ? chipOn : chip}
                onClick={() => setRunMode("parallel")}
              >
                Parallel
              </button>
            </div>
            <p style={help}>
              {runMode === "sequential"
                ? "One agent after another (they can read prior replies)."
                : "All agents at once."}
            </p>
            <button
              type="button"
              style={{ ...primaryBtn, background: running ? "#374151" : "#059669", fontSize: 15 }}
              disabled={running}
              onClick={runAgents}
            >
              {running ? "Running agents…" : "▶ Run agents"}
            </button>
            <button type="button" style={{ ...ghostBtn, marginTop: 8, width: "100%" }} onClick={() => setStep(3)}>
              ← Agents
            </button>
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Activity (synced)</h2>
            {!history.length ? (
              <p style={help}>No posts yet — run agents.</p>
            ) : (
              history.map((c) => (
                <div key={c.id} style={{ ...listBox, marginBottom: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#9aa0a6" }}>
                    <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role}
                  </div>
                  <pre style={pre}>{c.content}</pre>
                </div>
              ))
            )}
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Storage & jobs</h2>
            <p style={help}>
              Shared board is always synced via the API. Artifacts/jobs appear when the backend supports them.
            </p>
            {artifacts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {artifacts.map((a) => (
                  <div key={a.id} style={{ fontSize: 12, color: "#c5cae0", padding: "4px 0" }}>
                    📄 {a.name} <span style={{ color: "#6b7280" }}>({a.kind})</span>
                  </div>
                ))}
              </div>
            )}
            <input
              style={input}
              placeholder="Shell command (optional job)"
              value={jobCmd}
              onChange={(e) => setJobCmd(e.target.value)}
            />
            <button type="button" style={ghostBtn} onClick={enqueueJob}>
              Queue job
            </button>
            {jobs.slice(0, 5).map((j) => (
              <div key={j.id} style={{ fontSize: 11, color: "#9aa0a6", marginTop: 6 }}>
                {j.status}: {j.command}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

const page: CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "12px 12px 40px",
  maxWidth: 560,
  margin: "0 auto",
  background: "#0b0d12",
  color: "#e8eaed",
  minHeight: "100vh",
};
const header: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 12,
};
const stepNav: CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 14,
  background: "#14171e",
  borderRadius: 12,
  padding: 4,
  border: "1px solid #252a35",
};
const stepBtn: CSSProperties = {
  flex: 1,
  border: "none",
  borderRadius: 9,
  padding: "10px 4px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const stepNum: CSSProperties = {
  display: "inline-block",
  width: 18,
  height: 18,
  lineHeight: "18px",
  borderRadius: 9,
  background: "rgba(255,255,255,0.12)",
  textAlign: "center",
  marginRight: 4,
  fontSize: 11,
};
const card: CSSProperties = {
  background: "#14171e",
  border: "1px solid #252a35",
  borderRadius: 14,
  padding: 14,
};
const h2: CSSProperties = {
  margin: "0 0 6px",
  fontSize: 15,
  fontWeight: 700,
};
const help: CSSProperties = { margin: "0 0 12px", fontSize: 12, color: "#9aa0a6", lineHeight: 1.4 };
const label: CSSProperties = { display: "block", fontSize: 11, color: "#9aa0a6", marginBottom: 4 };
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
const primaryBtn: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #2a2e35",
  background: "#0b0d12",
  color: "#c5cae0",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const dangerBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "none",
  background: "#7f1d1d",
  color: "#fecaca",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const chipRow: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 };
const chip: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 20,
  border: "1px solid #2a2e35",
  background: "#0b0d12",
  color: "#c5cae0",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const chipOn: CSSProperties = { ...chip, background: "#1e3a5f", borderColor: "#3b82f6", color: "#fff" };
const listBox: CSSProperties = {
  background: "#0b0d12",
  border: "1px solid #252a35",
  borderRadius: 10,
  overflow: "hidden",
};
const listRow: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  width: "100%",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid #1a1d24",
  background: "transparent",
  color: "#e8eaed",
  fontSize: 12,
  cursor: "pointer",
};
const rowBetween: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};
const toastBox: CSSProperties = {
  background: "#064e3b",
  color: "#a7f3d0",
  padding: "10px 12px",
  borderRadius: 10,
  marginBottom: 10,
  fontSize: 13,
};
const errBox: CSSProperties = {
  background: "#2a1215",
  border: "1px solid #7f1d1d",
  padding: 12,
  borderRadius: 12,
  marginBottom: 10,
  fontSize: 13,
};
const pre: CSSProperties = {
  margin: "6px 0 0",
  whiteSpace: "pre-wrap",
  fontFamily: "inherit",
  fontSize: 13,
  lineHeight: 1.45,
};
