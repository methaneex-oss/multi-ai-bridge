"use client";

import { useEffect, useState, type CSSProperties } from "react";

const bridge = (p: string) => `/api/bridge/${p.replace(/^\//, "")}`;

type Project = { id: string; name: string; description?: string; rules?: string };
type Artifact = { id: string; name: string; kind: string; content?: string };

export function ProjectPanel({
  projectId,
  onProjectId,
}: {
  projectId: string;
  onProjectId: (id: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [knowledge, setKnowledge] = useState<Artifact[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [kName, setKName] = useState("");
  const [kContent, setKContent] = useState("");
  const [msg, setMsg] = useState("");

  async function refresh() {
    try {
      const res = await fetch(bridge("api/v1/projects"));
      if (res.ok) setProjects(await res.json());
    } catch {
      /* */
    }
  }

  async function loadKnowledge(pid: string) {
    if (!pid) {
      setKnowledge([]);
      return;
    }
    try {
      const res = await fetch(bridge(`api/v1/artifacts?project_id=${encodeURIComponent(pid)}`));
      if (res.ok) setKnowledge(await res.json());
    } catch {
      /* */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    loadKnowledge(projectId);
  }, [projectId]);

  async function saveProject() {
    if (!name.trim()) {
      setMsg("Project name required");
      return;
    }
    const res = await fetch(bridge("api/v1/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: projectId || undefined,
        name: name.trim(),
        description: description.trim(),
        rules: rules.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(String(data.error || "Save failed — redeploy API if /projects missing"));
      return;
    }
    onProjectId(data.id);
    setMsg(`Project saved: ${data.name}`);
    await refresh();
  }

  async function addKnowledge() {
    if (!projectId) {
      setMsg("Save a project first");
      return;
    }
    if (!kContent.trim()) {
      setMsg("Paste training text");
      return;
    }
    const res = await fetch(bridge("api/v1/knowledge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        name: kName.trim() || "training",
        content: kContent.trim(),
        kind: "knowledge",
      }),
    });
    if (!res.ok) {
      // fallback artifacts
      const r2 = await fetch(bridge("api/v1/artifacts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: kName.trim() || "training",
          content: kContent.trim(),
          kind: "knowledge",
        }),
      });
      if (!r2.ok) {
        setMsg("Knowledge API failed — redeploy Render API");
        return;
      }
    }
    setKContent("");
    setKName("");
    setMsg("Training data added");
    await loadKnowledge(projectId);
  }

  async function deleteKnowledge(id: string) {
    if (!confirm("Delete this training doc?")) return;
    await fetch(bridge(`api/v1/artifacts?id=${encodeURIComponent(id)}`), { method: "DELETE" });
    await loadKnowledge(projectId);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete project and its knowledge?")) return;
    await fetch(bridge(`api/v1/projects?id=${encodeURIComponent(id)}`), { method: "DELETE" });
    if (projectId === id) onProjectId("");
    await refresh();
  }

  return (
    <div>
      <p style={help}>
        <strong>Project</strong> = long-lived (rules + training data). <strong>Task</strong> = one job under that
        project. Agents get both on every run.
      </p>
      {msg && <p style={{ color: "#6ee7b7", fontSize: 12 }}>{msg}</p>}

      {projects.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#9aa0a6", marginBottom: 6 }}>Open project</div>
          {projects.map((p) => (
            <div key={p.id} style={row}>
              <button
                type="button"
                style={{
                  ...ghost,
                  flex: 1,
                  textAlign: "left",
                  borderColor: projectId === p.id ? "#3b82f6" : "#2a2e35",
                }}
                onClick={() => {
                  onProjectId(p.id);
                  setName(p.name);
                  setDescription(p.description || "");
                  setRules(p.rules || "");
                }}
              >
                {p.name}
              </button>
              <button type="button" style={danger} onClick={() => deleteProject(p.id)}>
                Del
              </button>
            </div>
          ))}
        </div>
      )}

      <input style={input} placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea
        style={{ ...input, minHeight: 48 }}
        placeholder="What is this product / codebase?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        style={{ ...input, minHeight: 72 }}
        placeholder="Project rules (always apply to every task)"
        value={rules}
        onChange={(e) => setRules(e.target.value)}
      />
      <button type="button" style={primary} onClick={saveProject}>
        Save project
      </button>

      <h3 style={{ fontSize: 13, margin: "16px 0 8px" }}>Training data / knowledge</h3>
      <p style={help}>Paste specs, APIs, architecture notes, samples. Agents load this on every run.</p>
      <input style={input} placeholder="Doc name" value={kName} onChange={(e) => setKName(e.target.value)} />
      <textarea
        style={{ ...input, minHeight: 100 }}
        placeholder="Paste project knowledge here…"
        value={kContent}
        onChange={(e) => setKContent(e.target.value)}
      />
      <button type="button" style={primary} onClick={addKnowledge}>
        Add to project memory
      </button>

      {knowledge.map((k) => (
        <div key={k.id} style={{ ...row, marginTop: 8 }}>
          <div style={{ flex: 1, fontSize: 12 }}>
            <strong>{k.name}</strong>
            <span style={{ color: "#6b7280" }}> · {k.kind}</span>
          </div>
          <button type="button" style={danger} onClick={() => deleteKnowledge(k.id)}>
            Del
          </button>
        </div>
      ))}
    </div>
  );
}

const help: CSSProperties = { margin: "0 0 10px", fontSize: 12, color: "#9aa0a6", lineHeight: 1.4 };
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
const primary: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 600,
  marginBottom: 8,
  cursor: "pointer",
};
const ghost: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #2a2e35",
  background: "#0b0d12",
  color: "#e8eaed",
  cursor: "pointer",
};
const danger: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "none",
  background: "#7f1d1d",
  color: "#fecaca",
  fontSize: 12,
  cursor: "pointer",
};
const row: CSSProperties = { display: "flex", gap: 6, alignItems: "center" };
