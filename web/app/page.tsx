"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef } from "../lib/autoAssign";

type State = { project_id?: string; task_title?: string; version?: number; current_status?: string };
type Contribution = { id: string; agent_name: string; role: string; content: string };
type Provider = { id: string; name: string; base_url: string; model: string; api_key: string; enabled: boolean };

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;
const LS_KEY = "mab_simple_v1";
const PROVIDER = {
  id: "openrouter",
  name: "OpenRouter",
  base_url: "https://openrouter.ai/api/v1",
  key_url: "https://openrouter.ai/keys",
};

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [work, setWork] = useState("");
  const [rules, setRules] = useState("");
  const [projectId, setProjectId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<Contribution[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const say = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 4000);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.apiKey) {
        setApiKey(d.apiKey);
        setModel(d.model || "");
        setConnected(!!d.apiKey);
      }
      if (d.projectId) setProjectId(d.projectId);
      if (d.projectName) setProjectName(d.projectName);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({ apiKey, model, projectId, projectName }));
  }, [apiKey, model, projectId, projectName]);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([fetch(bridge("api/v1/state")), fetch(bridge("api/v1/history"))]);
      if (s.ok) setState(await s.json());
      if (h.ok) setHistory(await h.json());
      setErr(null);
    } catch {
      setErr("Cannot reach the server. Wait 30s then tap Refresh.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function pickFreeModel() {
    const res = await fetch("/api/recommend-free?prefer=code", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const list = data?.recommended || data?.models || [];
    return (list[0]?.id as string) || "openrouter/free";
  }

  async function connect() {
    if (!apiKey.trim()) return say("Paste your OpenRouter API key first");
    setBusy(true);
    setErr(null);
    try {
      let m = model.trim();
      if (!m) {
        m = await pickFreeModel();
        setModel(m);
      }
      const tryTest = async (modelId: string) => {
        const res = await fetch("/api/test-provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base_url: PROVIDER.base_url, api_key: apiKey.trim(), model: modelId }),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      let { res, data } = await tryTest(m);
      if (!res.ok || !data.ok) {
        const free = await pickFreeModel();
        ({ res, data } = await tryTest(free));
        if (res.ok && data.ok) {
          setModel(free);
          setConnected(true);
          say("Connected with free model: " + free);
          setStep(2);
          return;
        }
        setErr(String(data.error || data.message || "Key failed") + " — check key at openrouter.ai/keys");
        setConnected(false);
        return;
      }
      setConnected(true);
      say("Connected — go to step 2");
      setStep(2);
    } catch (e: any) {
      setErr(e?.message || "Connection failed");
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }

  async function saveWork() {
    if (!work.trim()) return say("Describe what you want built");
    setBusy(true);
    setErr(null);
    try {
      let pid = projectId;
      if (!pid) {
        const name = projectName.trim() || "My project";
        const res = await fetch(bridge("api/v1/projects"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: work.trim().slice(0, 500),
            rules: rules.trim() || "Prefer correct, simple solutions.",
          }),
        });
        if (!res.ok) throw new Error((await res.text()).slice(0, 120));
        const p = await res.json();
        pid = p.id;
        setProjectId(pid);
        setProjectName(name);
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
        if (tres.status === 409) throw new Error("Board updated — Refresh then save again");
        throw new Error((await tres.text()).slice(0, 140));
      }
      await refresh();
      say("Saved — go to step 3");
      setStep(3);
    } catch (e: any) {
      setErr(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!apiKey.trim()) {
      say("Connect key in step 1");
      setStep(1);
      return;
    }
    if (!work.trim()) {
      say("Describe work in step 2");
      setStep(2);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let runModel = model.trim() || (await pickFreeModel());
      setModel(runModel);
      setConnected(true);
      const providers: Provider[] = [
        {
          id: PROVIDER.id,
          name: PROVIDER.name,
          base_url: PROVIDER.base_url,
          model: runModel,
          api_key: apiKey.trim(),
          enabled: true,
        },
      ];
      let agents: AgentDef[] = DEFAULT_AGENTS.slice(0, 3);
      agents = autoAssignAgents(
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
      const res = await fetch("/api/run-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers,
          agents,
          mode: "sequential",
          project_id: projectId || state?.project_id,
          auto_assign: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Run failed");
      const results = data.results || [];
      const ok = results.filter((r: any) => r.ok).length;
      const fail = results.filter((r: any) => !r.ok);
      if (ok === 0 && fail[0]) setErr(fail[0].detail || "All agents failed");
      else say(`Done — ${ok} agent(s) replied`);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={page}>
      <header style={header}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Multi-AI Bridge</div>
          <div style={sub}>Three steps: Connect → Describe → Run</div>
        </div>
        <button type="button" style={ghost} onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </header>
      {msg && <div style={okBox}>{msg}</div>}
      {err && <div style={errBox}>{err}</div>}
      <nav style={nav}>
        {(
          [
            [1, "1. Connect"],
            [2, "2. Describe"],
            [3, "3. Run"],
          ] as const
        ).map(([n, label]) => (
          <button
            key={n}
            type="button"
            style={{ ...navBtn, background: step === n ? "#2563eb" : "transparent", color: step === n ? "#fff" : "#9aa0a6" }}
            onClick={() => setStep(n)}
          >
            {label}
            {n === 1 && connected ? " ✓" : ""}
          </button>
        ))}
      </nav>
      {step === 1 && (
        <section style={card}>
          <h2 style={h2}>Connect</h2>
          <p style={help}>
            Get a key at{" "}
            <a href={PROVIDER.key_url} target="_blank" rel="noreferrer" style={link}>
              openrouter.ai/keys
            </a>
            , paste it, leave model blank, press Connect.
          </p>
          <label style={label}>OpenRouter API key</label>
          <input
            style={input}
            type="password"
            placeholder="sk-or-v1-…"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setConnected(false);
            }}
          />
          <label style={label}>Model (blank = free auto)</label>
          <input style={input} placeholder="auto" value={model} onChange={(e) => setModel(e.target.value)} />
          <button type="button" style={primary} onClick={connect} disabled={busy}>
            {busy ? "Checking…" : connected ? "Connected ✓" : "Connect"}
          </button>
          {connected && (
            <button type="button" style={{ ...primary, marginTop: 8, background: "#059669" }} onClick={() => setStep(2)}>
              Next →
            </button>
          )}
        </section>
      )}
      {step === 2 && (
        <section style={card}>
          <h2 style={h2}>Describe the work</h2>
          <p style={help}>One clear goal works best.</p>
          <label style={label}>Project name (optional)</label>
          <input style={input} placeholder="My project" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <label style={label}>What to do</label>
          <textarea
            style={{ ...input, minHeight: 120 }}
            placeholder="Example: Build a Python number guessing game with a README"
            value={work}
            onChange={(e) => setWork(e.target.value)}
          />
          <label style={label}>Extra rules (optional)</label>
          <textarea style={{ ...input, minHeight: 60 }} placeholder="Keep it simple" value={rules} onChange={(e) => setRules(e.target.value)} />
          <button type="button" style={primary} onClick={saveWork} disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </section>
      )}
      {step === 3 && (
        <section style={card}>
          <h2 style={h2}>Run</h2>
          <p style={help}>Agents plan → code → review. Wait 1–2 minutes.</p>
          <div style={summary}>
            <div>Key: {apiKey ? "ready" : "missing"}</div>
            <div>Model: {model || "auto free"}</div>
            <div>Work: {work.trim().slice(0, 100) || "(none)"}</div>
          </div>
          <button type="button" style={primary} onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run agents"}
          </button>
          <h3 style={{ ...h2, marginTop: 18 }}>Results</h3>
          {history.length === 0 && <p style={help}>No results yet.</p>}
          {history.slice(0, 12).map((h) => (
            <article key={h.id} style={resultCard}>
              <div style={resultMeta}>{h.role || h.agent_name}</div>
              <pre style={resultBody}>{String(h.content || "").slice(0, 2000)}</pre>
            </article>
          ))}
        </section>
      )}
      <footer style={footer}>{err ? "If stuck, wait 30s and Refresh" : "Server ok"}</footer>
    </main>
  );
}

const page: CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "16px 14px 40px",
  fontFamily: "system-ui,sans-serif",
  background: "#0c0e12",
  color: "#e8eaed",
  minHeight: "100vh",
};
const header: CSSProperties = { display: "flex", justifyContent: "space-between", marginBottom: 16 };
const sub: CSSProperties = { fontSize: 13, color: "#9aa0a6", marginTop: 4 };
const nav: CSSProperties = { display: "flex", gap: 4, marginBottom: 14, background: "#161a22", borderRadius: 12, padding: 4, border: "1px solid #2a2f3a" };
const navBtn: CSSProperties = { flex: 1, border: "none", borderRadius: 9, padding: "10px 6px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const card: CSSProperties = { background: "#161a22", border: "1px solid #2a2f3a", borderRadius: 14, padding: 16 };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 17, fontWeight: 700 };
const help: CSSProperties = { margin: "0 0 14px", fontSize: 13, color: "#9aa0a6" };
const label: CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#c5cae0", marginBottom: 4 };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 12,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #2a2f3a",
  background: "#0c0e12",
  color: "#e8eaed",
  fontSize: 15,
};
const primary: CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};
const ghost: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #2a2f3a",
  background: "#0c0e12",
  color: "#c5cae0",
  fontWeight: 600,
  cursor: "pointer",
};
const link: CSSProperties = { color: "#60a5fa" };
const okBox: CSSProperties = { background: "#064e3b", color: "#a7f3d0", padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 14 };
const errBox: CSSProperties = {
  background: "#2a1215",
  border: "1px solid #7f1d1d",
  color: "#fecaca",
  padding: 12,
  borderRadius: 10,
  marginBottom: 12,
  fontSize: 14,
};
const summary: CSSProperties = { background: "#0c0e12", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, border: "1px solid #2a2f3a" };
const resultCard: CSSProperties = { background: "#0c0e12", border: "1px solid #2a2f3a", borderRadius: 10, padding: 12, marginBottom: 10 };
const resultMeta: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#60a5fa", marginBottom: 6 };
const resultBody: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 13,
  fontFamily: "ui-monospace,monospace",
  color: "#d1d5db",
};
const footer: CSSProperties = { marginTop: 20, fontSize: 11, color: "#6b7280", textAlign: "center" };
