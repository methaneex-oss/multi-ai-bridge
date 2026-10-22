/** Auto-assign agents to provider models from role + project context. */

export type ModelInfo = {
  id: string;
  tags?: string[];
  prompt_price?: string | null;
};

export type ProviderInfo = {
  id: string;
  name: string;
  enabled: boolean;
  api_key: string;
  base_url: string;
  models?: ModelInfo[];
};

export type AgentDef = {
  id: string;
  role: string;
  provider_id?: string;
  model?: string;
  capabilities?: string[];
};

const ROLE_PREFS: Record<string, string[]> = {
  architect: ["reasoning", "general"],
  planner: ["reasoning", "general"],
  coder: ["code", "general"],
  engineer: ["code", "general"],
  builder: ["code", "general"],
  reviewer: ["review", "reasoning", "fast"],
  critic: ["review", "reasoning"],
  tester: ["code", "fast"],
  researcher: ["reasoning", "general"],
};

function roleKey(role: string) {
  return role.toLowerCase().replace(/\s+/g, "");
}

function scoreModel(model: ModelInfo, wanted: string[], contextHint: string): number {
  const tags = model.tags || ["general"];
  let score = 0;
  for (const w of wanted) {
    if (tags.includes(w)) score += 3;
  }
  const id = model.id.toLowerCase();
  const ctx = contextHint.toLowerCase();
  if (ctx.includes("code") || ctx.includes("implement") || ctx.includes("api")) {
    if (tags.includes("code")) score += 2;
  }
  if (ctx.includes("design") || ctx.includes("architect") || ctx.includes("plan")) {
    if (tags.includes("reasoning")) score += 2;
  }
  // Prefer mid-tier names slightly for balance
  if (/sonnet|gpt-4o[^m]|deepseek-chat|gemini.*flash/.test(id)) score += 1;
  // Soft penalty for huge expensive ids when fast wanted
  if (wanted.includes("fast") && /opus|o1|o3|gpt-4\.5/.test(id)) score -= 1;
  return score;
}

export function autoAssignAgents(
  agents: AgentDef[],
  providers: ProviderInfo[],
  projectContext: string
): AgentDef[] {
  const enabled = providers.filter((p) => p.enabled && p.api_key);
  if (!enabled.length) return agents;

  // Flatten candidate models with provider id
  type Cand = { provider_id: string; model: string; tags: string[]; score?: number };
  const pool: Cand[] = [];
  for (const p of enabled) {
    const models = p.models?.length
      ? p.models
      : [{ id: (p as any).default_model || "", tags: ["general"] }];
    for (const m of models) {
      if (!m.id) continue;
      pool.push({ provider_id: p.id, model: m.id, tags: m.tags || ["general"] });
    }
  }
  if (!pool.length) return agents;

  const used = new Set<string>();

  return agents.map((agent) => {
    // Keep manual assignment if both set
    if (agent.provider_id && agent.model) return agent;

    const rk = roleKey(agent.role);
    const wanted =
      agent.capabilities?.length ||
      ROLE_PREFS[rk] ||
      ROLE_PREFS[Object.keys(ROLE_PREFS).find((k) => rk.includes(k)) || ""] ||
      ["general"];

    let best: Cand | null = null;
    let bestScore = -999;
    for (const c of pool) {
      const s = scoreModel({ id: c.model, tags: c.tags }, wanted, projectContext);
      // slight diversity: prefer unused model ids
      const diversity = used.has(c.model) ? -0.5 : 0;
      const total = s + diversity;
      if (total > bestScore) {
        bestScore = total;
        best = c;
      }
    }
    if (!best) return agent;
    used.add(best.model);
    return {
      ...agent,
      provider_id: best.provider_id,
      model: best.model,
    };
  });
}

export const DEFAULT_AGENTS: AgentDef[] = [
  { id: "architect", role: "Architect", capabilities: ["reasoning"] },
  { id: "coder", role: "Coder", capabilities: ["code"] },
  { id: "reviewer", role: "Reviewer", capabilities: ["review", "fast"] },
];
