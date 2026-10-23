"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";

type Tab = "overview" | "tasks" | "agents" | "activity" | "providers";

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

type ModelInfo = {
  id: string;
  name?: string;
  tags?: string[];
  context?: number | null;
  free?: boolean;
  score?: number;
};

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
  free_tier?: boolean;
};

const api = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS_P = "mab_providers_v3";
const LS_A = "mab_agents_v2";

/** Gateway templates only — models are filled from live free catalog, not hard-coded winners. */
const FREE_GATEWAYS: {
  name: string;
  base_url: string;
  label: string;
  hint: string;
  free_tier: boolean;
  key_url: string;
}[] = [
  {
    name: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    label: "OpenRouter (recommended)",
    hint: "One key · many free models · best for coding + analysis",
    free_tier: true,
    key_url: "https://openrouter.ai/keys",
  },
  {
    name: "groq",
    base_url: "https://api.groq.com/openai/v1",
    label: "Groq",
    hint: "Fast free tier · OpenAI-compatible",
    free_tier: true,
    key_url: "https://console.groq.com/keys",
  },
  {
    name: "deepseek",
    base_url: "https://api.deepseek.com/v1",
    label: "DeepSeek",
    hint: "Strong coding · often low cost (check account balance)",
    free_tier: false,
    key_url: "https://platform.deepseek.com/api_keys",
  },
  {
    name: "google",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    label: "Google Gemini",
    hint: "Free tier via AI Studio · OpenAI-compatible endpoint",
    free_tier: true,
    key_url: "https://aistudio.google.com/apikey",
  },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<"sequential" | "parallel">("sequential");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");

  const [providers, setProviders] = useState<Provider[]>([]);
  const [agents, setAgents] = useState<AgentDef[]>(DEFAULT_AGENTS);
  const [form, setForm] = useState({ name: "", base_url: "", model: "", api_key: "" });
  const [testing, setTesting] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState<string | null>(null);
  const [browseModels, setBrowseModels] = useState<ModelInfo[]>([]);
  const [browseFor, setBrowseFor] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [freeRecs, setFreeRecs] = useState<ModelInfo[]>([]);
  const [freeUpdated, setFreeUpdated] = useState<string | null>(null);
  const [loadingFree, setLoadingFree] = useState(false);
  const [prefer, setPrefer] = useState<"balanced" | "code" | "analysis">("balanced");

  useEffect(() => {
    try {
      const p = localStorage.getItem(LS_P);
      const a = localStorage.getItem(LS_A);
      if (p) setProviders(JSON.parse(p));
      if (a) setAgents(JSON.parse(a));
    } catch {
      /* ignore */
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

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(api("api/v1/state")), fetch(api("api/v1/history"))]);
      if (!s.ok) {
        const t = await s.text();
        let d = t;
        try {
          const j = JSON.parse(t);
          d = j.detail || j.error || t;
        } catch {
          /* */
        }
        throw new Error(d);
      }
      setState(await s.json());
      if (h.ok) {
        const hj = await h.json();
        setHistory(Array.isArray(hj) ? hj : []);
      }
      setError(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Backend unreachable — open API /health then Retry";
      setError(message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12000);
    return () => clearInterval(id);
  }, [refresh]);

  async function loadFreeRecommendations(pref: "balanced" | "code" | "analysis" = prefer) {
    setLoadingFree(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/recommend-free?prefer=${pref}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load free models");
      setFreeRecs(data.recommended || []);
      setFreeUpdated(data.updated_at || new Date().toISOString());
      setMsg(`Loaded ${data.count || 0} free models (live rank · ${pref})`);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Free catalog failed");
      setFreeRecs([]);
    } finally {
      setLoadingFree(false);
    }
  }

  useEffect(() => {
    if (tab === "providers") loadFreeRecommendations(prefer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 200));
      setMsg("Task published");
      await refresh();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(p: Provider) {
    if (!p.api_key) {
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, last_ok: false, last_test: "API key missing" } : x))
      );
      return;
    }
    setTesting(p.id);
    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: p.base_url,
          model: p.model || p.models?.[0]?.id || "",
          api_key: p.api_key,
        }),
      });
      const data = await res.json();
      setProviders((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? {
                ...x,
                last_ok: !!data.ok,
                last_test: data.ok ? "Works: ready" : String(data.error || "failed"),
              }
            : x
        )
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "test failed";
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, last_ok: false, last_test: message } : x))
      );
    } finally {
      setTesting(null);
    }
  }

  async function loadModels(p: Provider, freeOnly = false) {
    setLoadingModels(p.id);
    setBrowseFor(p.id);
    setModelFilter(freeOnly ? "free" : "");
    try {
      const res = await fetch("/api/list-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: p.base_url,
          api_key: p.api_key,
          name: p.name,
          free_only: freeOnly,
          prefer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "list failed");
      const models: ModelInfo[] = data.models || [];
      setBrowseModels(models);
      setProviders((prev) => prev.map((x) => (x.id === p.id ? { ...x, models } : x)));
      const topFree = (data.recommended_free || models.filter((m) => m.free))[0];
      if (topFree?.id && !p.model) {
        setProviders((prev) => prev.map((x) => (x.id === p.id ? { ...x, model: topFree.id } : x)));
      }
      setMsg(`Loaded ${models.length} models${freeOnly ? " (free only)" : ""}`);
    } catch (e: unknown) {
      setMsg(`Models: ${e instanceof Error ? e.message : "failed"}`);
      setBrowseModels([]);
    } finally {
      setLoadingModels(null);
    }
  }

  function addGateway(g: (typeof FREE_GATEWAYS)[0]) {
    setForm({
      name: g.name,
      base_url: g.base_url,
      model: "",
      api_key: "",
    });
    setMsg(`${g.label}: base URL filled — paste key, save, then pick a live free model`);
  }

  function applyFreeModelToOpenRouter(modelId: string) {
    const id = "openrouter";
    setProviders((prev) => {
      const existing = prev.find((p) => p.id === id);
      const next: Provider = {
        id,
        name: "openrouter",
        base_url: "https://openrouter.ai/api/v1",
        model: modelId,
        api_key: existing?.api_key || "",
        enabled: true,
        free_tier: true,
        models: existing?.models,
        last_test: existing?.last_test,
        last_ok: existing?.last_ok,
      };
      if (existing) return prev.map((p) => (p.id === id ? next : p));
      return [...prev, next];
    });
    setForm((f) => ({
      ...f,
      name: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      model: modelId,
    }));
    setMsg(`Selected free model ${modelId} — paste OpenRouter key and Save if not saved yet`);
  }

  function saveProvider() {
    if (!form.name.trim() || !form.base_url.trim()) {
      setMsg("Name and base URL required");
      return;
    }
    const id = form.name.toLowerCase().replace(/\s+/g, "-");
    const gw = FREE_GATEWAYS.find((g) => g.name === id);
    setProviders((prev) => {
      const existing = prev.find((p) => p.id === id);
      const next: Provider = {
        id,
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        model: form.model.trim() || existing?.model || "",
        api_key: form.api_key || existing?.api_key || "",
        enabled: existing?.enabled ?? true,
        free_tier: gw?.free_tier ?? existing?.free_tier,
        models: existing?.models,
        last_test: existing?.last_test,
        last_ok: existing?.last_ok,
      };
      if (existing) return prev.map((p) => (p.id === id ? next : p));
      return [...prev, next];
    });
    setForm({ name: "", base_url: "", model: "", api_key: "" });
    setMsg("Provider saved");
  }

  function deleteProvider(id: string) {
    if (typeof window !== "undefined" && !window.confirm(`Delete provider "${id}"?`)) return;
    setProviders((prev) => prev.filter((x) => x.id !== id));
    if (browseFor === id) {
      setBrowseFor(null);
      setBrowseModels([]);
    }
    setAgents((prev) =>
      prev.map((a) => (a.provider_id === id ? { ...a, provider_id: undefined, model: undefined } : a))
    );
    setMsg(`Deleted provider ${id}`);
  }

  function doAutoAssign() {
    const enabled = providers.filter((p) => p.enabled && p.api_key);
    if (!enabled.length) {
      setMsg("Enable at least one provider with a key first");
      return;
    }
    const ctx = [state?.task_title, state?.task_description, state?.instructions, ...(state?.goals || [])]
      .filter(Boolean)
      .join(" ");
    const provInfos = enabled.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: true,
      api_key: p.api_key,
      base_url: p.base_url,
      models: p.models?.length
        ? p.models
        : p.model
          ? [{ id: p.model, tags: ["general"] }]
          : [],
    }));
    setAgents(autoAssignAgents(agents, provInfos, ctx || "general project"));
    setMsg("Auto-assigned from role + project context");
  }

  async function runAgents() {
    setRunning(true);
    setMsg(null);
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
            models: p.models?.length ? p.models : p.model ? [{ id: p.model, tags: ["general"] }] : [],
          })),
          agents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Run failed (${res.status})`);

      if (Array.isArray(data.assignments)) {
        setAgents((prev) =>
          prev.map((a) => {
            const m = data.assignments.find(
              (x: { id: string; provider_id?: string; model?: string }) => x.id === a.id
            );
            return m ? { ...a, provider_id: m.provider_id, model: m.model } : a;
          })
        );
      }

      const list = data.results || [];
      const ok = list.filter((r: { ok: boolean }) => r.ok).length;
      const bad = list.filter((r: { ok: boolean }) => !r.ok);
      setMsg(
        `${data.mode || runMode}: ${ok} ok` +
          (bad.length
            ? ` · ${bad.length} failed` +
              (bad[0]?.detail ? ` (${bad[0].agent}: ${String(bad[0].detail).slice(0, 80)})` : "")
            : "")
      );
      if (data.state) setState(data.state);
      if (data.history) setHistory(data.history);
      else await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "agents", label: "Agents" },
    { id: "activity", label: "Activity" },
    { id: "providers", label: "Providers" },
  ];

  const filteredModels = browseModels.filter((m) => {
    if (!modelFilter) return true;
    const f = modelFilter.toLowerCase();
    if (f === "free") return !!m.free;
    return (
      m.id.toLowerCase().includes(f) ||
      (m.tags || []).some((t) => t.includes(f)) ||
      (m.name || "").toLowerCase().includes(f)
    );
  });

  return (
    <main style={page}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Multi-AI Bridge</h1>
        <p style={{ margin: "4px 0 0", color: "#9aa0a6", fontSize: 12 }}>
          Assign · Auto-route · Sequential or parallel runs
        </p>
      </header>

      <nav style={nav}>
        {tabs.map((t) => (
          <button key={t.id} type="button" style={tab === t.id ? tabOn : tabOff} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div style={errBox}>
          {error}
          <button type="button" style={{ ...btn, marginTop: 8, background: "#4b5563" }} onClick={() => refresh()}>
            Retry
          </button>
        </div>
      )}
      {msg && <div style={{ color: "#6ee7b7", fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {tab === "overview" && (
        <>
          <section style={card}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                style={runMode === "sequential" ? modeOn : modeOff}
                onClick={() => setRunMode("sequential")}
              >
                Sequential
              </button>
              <button
                type="button"
                style={runMode === "parallel" ? modeOn : modeOff}
                onClick={() => setRunMode("parallel")}
              >
                Parallel
              </button>
            </div>
            <p style={{ color: "#9aa0a6", fontSize: 12, margin: "0 0 12px" }}>
              {runMode === "sequential"
                ? "Agents run one after another and can see prior posts in this run."
                : "All agents start together. One failure does not stop the others."}
            </p>
            <button
              type="button"
              style={{ ...btn, background: running ? "#374151" : "#10b981" }}
              disabled={running}
              onClick={runAgents}
            >
              {running ? "Running…" : "▶ Run agents"}
            </button>
          </section>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Task</h2>
            <p style={{ fontWeight: 600, margin: "0 0 6px" }}>{state?.task_title || "(none)"}</p>
            <p style={{ color: "#bdc1c6", fontSize: 14, margin: 0 }}>{state?.task_description}</p>
            <p style={{ color: "#9aa0a6", fontSize: 12, marginTop: 8 }}>
              {state?.current_status || "idle"} · v{state?.version ?? 0}
            </p>
          </section>
          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Agent lineup</h2>
            {agents.map((a) => (
              <div key={a.id} style={row}>
                <strong>{a.role}</strong>
                <div style={{ fontSize: 12, color: "#9aa0a6" }}>
                  {a.provider_id && a.model ? `${a.provider_id} → ${a.model}` : "auto"}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {tab === "tasks" && (
        <section style={card}>
          <h2 style={h2}>Set task + rules</h2>
          <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            style={{ ...input, minHeight: 60 }}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            style={{ ...input, minHeight: 60 }}
            placeholder="Instructions for all agents"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <button type="button" style={btn} disabled={busy} onClick={publishTask}>
            Publish task
          </button>
        </section>
      )}

      {tab === "agents" && (
        <section style={card}>
          <button type="button" style={{ ...btn, background: "#8b5cf6", marginBottom: 12 }} onClick={doAutoAssign}>
            Auto-assign from context
          </button>
          <p style={{ color: "#9aa0a6", fontSize: 12, marginTop: 0 }}>
            Leave provider/model empty for auto.
          </p>
          {agents.map((a) => (
            <div key={a.id} style={{ ...contrib, marginBottom: 10 }}>
              <strong>{a.role}</strong> <span style={{ color: "#9aa0a6", fontSize: 12 }}>({a.id})</span>
              <div style={{ marginTop: 8 }}>
                <label style={label}>Provider</label>
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
                  <option value="">(auto)</option>
                  {providers
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <label style={label}>Model</label>
                <input
                  style={input}
                  placeholder="model id or blank for auto"
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
        </section>
      )}

      {tab === "activity" && (
        <section style={card}>
          <h2 style={h2}>Timeline</h2>
          {!history.length ? (
            <p style={{ color: "#9aa0a6", fontSize: 13 }}>Empty — run agents</p>
          ) : (
            history.map((c) => (
              <div key={c.id} style={{ ...contrib, marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#9aa0a6" }}>
                  <strong style={{ color: "#e8eaed" }}>{c.agent_name}</strong> · {c.role} · {c.contribution_type}
                </div>
                <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13 }}>
                  {c.content}
                </pre>
              </div>
            ))
          )}
        </section>
      )}

      {tab === "providers" && (
        <>
          <section style={card}>
            <h2 style={h2}>Recommended free models (live)</h2>
            <p style={{ color: "#9aa0a6", fontSize: 12, margin: "0 0 10px" }}>
              Ranked from OpenRouter’s live free catalog — not a fixed list. Prefer coding or analysis, then pick a
              model. You only need an OpenRouter key.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {(["balanced", "code", "analysis"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  style={prefer === p ? modeOn : modeOff}
                  onClick={() => {
                    setPrefer(p);
                    loadFreeRecommendations(p);
                  }}
                >
                  {p}
                </button>
              ))}
              <button type="button" style={smallBtn} disabled={loadingFree} onClick={() => loadFreeRecommendations(prefer)}>
                {loadingFree ? "Refreshing…" : "Refresh ranks"}
              </button>
            </div>
            {freeUpdated && (
              <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 8px" }}>
                Updated {new Date(freeUpdated).toLocaleString()}
              </p>
            )}
            {!freeRecs.length && !loadingFree && (
              <p style={{ color: "#9aa0a6", fontSize: 13 }}>No free models loaded — hit Refresh ranks.</p>
            )}
            <div style={{ maxHeight: 260, overflow: "auto" }}>
              {freeRecs.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid #252a35",
                    color: "#e8eaed",
                    cursor: "pointer",
                    padding: "8px 0",
                  }}
                  onClick={() => applyFreeModelToOpenRouter(m.id)}
                >
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: "#6ee7b7", marginRight: 6 }}>#{i + 1}</span>
                    {m.id}
                  </div>
                  <div style={{ fontSize: 11, color: "#9aa0a6" }}>
                    free · {(m.tags || []).join(", ")}
                    {m.context ? ` · ctx ${m.context}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Suggested gateways (base URL ready)</h2>
            <p style={{ color: "#9aa0a6", fontSize: 12, margin: "0 0 10px" }}>
              No OpenAI. Click a gateway → base URL fills in → paste key → Save → load free models.
            </p>
            {FREE_GATEWAYS.map((g) => (
              <div key={g.name} style={{ ...contrib, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>{g.label}</strong>
                    {g.free_tier && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "#6ee7b7" }}>free tier</span>
                    )}
                    <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 4 }}>{g.hint}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, wordBreak: "break-all" }}>
                      {g.base_url}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" style={smallBtn} onClick={() => addGateway(g)}>
                      Use this
                    </button>
                    <a href={g.key_url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: "none", display: "inline-block" }}>
                      Get key
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Your providers</h2>
            {!providers.length && (
              <p style={{ color: "#9aa0a6", fontSize: 13 }}>None yet — use a suggested gateway above.</p>
            )}
            {providers.map((p) => (
              <div key={p.id} style={{ ...contrib, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>{p.name}</strong>
                    {p.free_tier && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "#6ee7b7" }}>free tier</span>
                    )}
                    <div style={{ fontSize: 12, color: "#9aa0a6" }}>
                      {p.model || "(pick model)"}
                      {p.models?.length ? ` · ${p.models.length} models` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", wordBreak: "break-all" }}>{p.base_url}</div>
                    <div style={{ fontSize: 12, color: p.last_ok ? "#6ee7b7" : "#fca5a5", marginTop: 4 }}>
                      {p.last_test || "not tested"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" style={smallBtn} onClick={() => testProvider(p)} disabled={testing === p.id}>
                      {testing === p.id ? "…" : "Test"}
                    </button>
                    <button type="button" style={smallBtn} onClick={() => loadModels(p, false)} disabled={loadingModels === p.id}>
                      {loadingModels === p.id ? "…" : "Models"}
                    </button>
                    <button type="button" style={smallBtn} onClick={() => loadModels(p, true)} disabled={loadingModels === p.id}>
                      Free only
                    </button>
                    <button
                      type="button"
                      style={smallBtn}
                      onClick={() =>
                        setProviders((prev) =>
                          prev.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x))
                        )
                      }
                    >
                      {p.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" style={{ ...smallBtn, background: "#7f1d1d" }} onClick={() => deleteProvider(p.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          {browseFor && (
            <section style={{ ...card, marginTop: 12 }}>
              <h2 style={h2}>Models — {browseFor}</h2>
              <input
                style={input}
                placeholder="Filter (free, code, gemma, nemotron…)"
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
              />
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                {filteredModels.slice(0, 100).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid #252a35",
                      color: "#e8eaed",
                      cursor: "pointer",
                      padding: "8px 0",
                    }}
                    onClick={() => {
                      setProviders((prev) =>
                        prev.map((x) => (x.id === browseFor ? { ...x, model: m.id } : x))
                      );
                      setMsg(`Default model for ${browseFor}: ${m.id}`);
                    }}
                  >
                    <div style={{ fontSize: 13 }}>
                      {m.free ? <span style={{ color: "#6ee7b7" }}>free </span> : null}
                      {m.id}
                    </div>
                    <div style={{ fontSize: 11, color: "#9aa0a6" }}>{(m.tags || []).join(", ")}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section style={{ ...card, marginTop: 12 }}>
            <h2 style={h2}>Add / edit provider</h2>
            <input style={input} placeholder="Name (e.g. openrouter)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input style={input} placeholder="Base URL" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            <input style={input} placeholder="Model id (or pick from free list)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input style={input} placeholder="API key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            <button type="button" style={btn} onClick={saveProvider}>
              Save provider
            </button>
          </section>
        </>
      )}
    </main>
  );
}

const page: CSSProperties = {
  fontFamily: "system-ui,sans-serif",
  padding: "14px 12px 48px",
  maxWidth: 720,
  margin: "0 auto",
  background: "#0b0d12",
  color: "#e8eaed",
  minHeight: "100vh",
};
const nav: CSSProperties = { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" };
const tabOn: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
};
const tabOff: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #252a35",
  background: "#14171e",
  color: "#c5cae0",
  fontSize: 13,
};
const modeOn: CSSProperties = {
  flex: 1,
  padding: "8px",
  borderRadius: 8,
  border: "none",
  background: "#1d4ed8",
  color: "#fff",
  fontWeight: 600,
  fontSize: 12,
};
const modeOff: CSSProperties = {
  flex: 1,
  padding: "8px",
  borderRadius: 8,
  border: "1px solid #252a35",
  background: "#0b0d12",
  color: "#c5cae0",
  fontSize: 12,
};
const card: CSSProperties = {
  background: "#14171e",
  border: "1px solid #252a35",
  borderRadius: 14,
  padding: 14,
};
const h2: CSSProperties = {
  margin: "0 0 10px",
  fontSize: 11,
  fontWeight: 700,
  color: "#9aa0a6",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};
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
const btn: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  width: "100%",
  fontSize: 14,
};
const smallBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "none",
  background: "#374151",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
};
const errBox: CSSProperties = {
  background: "#2a1215",
  border: "1px solid #7f1d1d",
  padding: 12,
  borderRadius: 12,
  marginBottom: 12,
  fontSize: 13,
};
const row: CSSProperties = {
  padding: "8px 0",
  borderBottom: "1px solid #252a35",
  fontSize: 13,
};
const contrib: CSSProperties = {
  background: "#0b0d12",
  borderRadius: 10,
  padding: 12,
  border: "1px solid #252a35",
};
const label: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#9aa0a6",
  marginBottom: 4,
};
