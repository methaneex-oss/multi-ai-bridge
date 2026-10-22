import { NextRequest, NextResponse } from "next/server";
import {
  autoAssignAgents,
  DEFAULT_AGENTS,
  type AgentDef,
  type ProviderInfo,
} from "../../../lib/autoAssign";

const BRIDGE = (process.env.BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";

async function bridge(path: string, init?: RequestInit) {
  if (!BRIDGE) throw new Error("BRIDGE_URL is not set on the UI service");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${BRIDGE}/${path}`, { ...init, headers, cache: "no-store" });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`Bridge ${path} ${res.status}`);
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Bridge ${path} ${res.status}: ${text.slice(0, 280)}`);
      return data;
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr || new Error("bridge unreachable");
}

async function chat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
        "X-Title": "Multi-AI Bridge",
      },
      body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.3 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (data as any)?.error?.message ||
        (data as any)?.error ||
        JSON.stringify(data).slice(0, 280);
      throw new Error(String(msg));
    }
    return (data as any)?.choices?.[0]?.message?.content || "(empty)";
  } finally {
    clearTimeout(timer);
  }
}

function contributionType(role: string) {
  const r = role.toLowerCase();
  if (r.includes("architect") || r.includes("plan")) return "plan";
  if (r.includes("coder") || r.includes("engineer") || r.includes("builder")) return "code";
  if (r.includes("review") || r.includes("critic")) return "review";
  if (r.includes("test")) return "test";
  return "update";
}

function buildMessages(agent: AgentDef, state: any, history: any[]) {
  const hist = (Array.isArray(history) ? history : [])
    .slice(0, 8)
    .map((h: any) => `- [${h.role}] ${String(h.content || "").slice(0, 350)}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `You are ${agent.role} (${agent.id}) on a multi-agent bridge.\n${state.instructions || ""}`,
    },
    {
      role: "user",
      content: `Task: ${state.task_title}\n${state.task_description || ""}\nStatus: ${state.current_status}\n\nRecent:\n${hist || "(none)"}\n\nAs ${agent.role}, produce the next useful contribution.`,
    },
  ];
}

async function runOne(
  agent: AgentDef,
  providers: ProviderInfo[],
  state: any,
  history: any[]
) {
  const prov = providers.find((p) => p.id === agent.provider_id) || providers[0];
  if (!prov?.api_key || !prov?.base_url) {
    return {
      agent: agent.id,
      role: agent.role,
      model: agent.model || "",
      ok: false as const,
      detail: "No provider available for this agent",
    };
  }
  const model =
    agent.model ||
    prov.models?.[0]?.id ||
    process.env.DEFAULT_MODEL ||
    "deepseek/deepseek-chat";

  try {
    const content = await chat(prov.base_url, prov.api_key, model, buildMessages(agent, state, history));
    await bridge("api/v1/contribute", {
      method: "POST",
      body: JSON.stringify({
        agent_name: agent.id,
        role: agent.role,
        content,
        contribution_type: contributionType(agent.role),
        metadata: { model, provider: prov.name, mode: "run" },
      }),
    });
    return { agent: agent.id, role: agent.role, model, ok: true as const };
  } catch (e: any) {
    return {
      agent: agent.id,
      role: agent.role,
      model,
      ok: false as const,
      detail: e?.name === "AbortError" ? "LLM timeout (90s)" : e?.message || String(e),
    };
  }
}

export async function POST(req: NextRequest) {
  if (!BRIDGE) {
    return NextResponse.json(
      { error: "Set BRIDGE_URL=https://multi-ai-bridge.onrender.com on the UI service" },
      { status: 500 }
    );
  }

  let body: {
    providers?: ProviderInfo[];
    agents?: AgentDef[];
    auto_assign?: boolean;
    /** sequential (default) = agents see each other; parallel = same-time fan-out */
    mode?: "sequential" | "parallel";
  } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const mode = body.mode === "parallel" ? "parallel" : "sequential";

  let providers = (body.providers || []).filter((p) => p.enabled && p.api_key && p.base_url);
  if (!providers.length && process.env.OPENROUTER_API_KEY) {
    providers = [
      {
        id: "openrouter",
        name: "openrouter",
        enabled: true,
        api_key: process.env.OPENROUTER_API_KEY,
        base_url: "https://openrouter.ai/api/v1",
        models: [
          {
            id: process.env.DEFAULT_MODEL || "deepseek/deepseek-chat",
            tags: ["general", "code"],
          },
        ],
      },
    ];
  }
  if (!providers.length) {
    return NextResponse.json(
      {
        error:
          "No enabled providers with API keys. Add OpenRouter under Providers, Test it, then Run.",
      },
      { status: 400 }
    );
  }

  let agents = body.agents?.length ? body.agents : [...DEFAULT_AGENTS];

  try {
    let state = await bridge("api/v1/state");
    if (!state.task_title) {
      state = await bridge("api/v1/task", {
        method: "POST",
        body: JSON.stringify({
          title: "Coordinate and advance the active project",
          description: "Multi-agent team on shared bridge state.",
          instructions: "Concrete next steps. Record decisions and questions.",
          goals: ["Clear next step"],
          constraints: ["Shared bridge only"],
        }),
      });
    }

    const context = [state.task_title, state.task_description, state.instructions, ...(state.goals || [])]
      .filter(Boolean)
      .join(" ");

    if (body.auto_assign !== false) {
      agents = autoAssignAgents(agents, providers, context);
    }

    agents = agents.map((a) => {
      if (a.provider_id && a.model) return a;
      const p = providers.find((x) => x.id === a.provider_id) || providers[0];
      const model = a.model || p.models?.[0]?.id || process.env.DEFAULT_MODEL || "deepseek/deepseek-chat";
      return { ...a, provider_id: p.id, model };
    });

    let history = await bridge("api/v1/history");
    const results: {
      agent: string;
      role: string;
      model: string;
      ok: boolean;
      detail?: string;
    }[] = [];

    if (mode === "parallel") {
      // Same-time fan-out; one failure does not cancel others
      const settled = await Promise.allSettled(
        agents.map((agent) => runOne(agent, providers, state, history))
      );
      for (const s of settled) {
        if (s.status === "fulfilled") results.push(s.value);
        else
          results.push({
            agent: "unknown",
            role: "",
            model: "",
            ok: false,
            detail: String(s.reason),
          });
      }
    } else {
      // Sequential: each agent can see prior posts in this run
      for (const agent of agents) {
        const r = await runOne(agent, providers, state, history);
        results.push(r);
        if (r.ok) {
          try {
            history = await bridge("api/v1/history");
            state = await bridge("api/v1/state");
          } catch {
            /* keep last good snapshot */
          }
        }
      }
    }

    let finalState = state;
    let finalHistory = history;
    try {
      finalState = await bridge("api/v1/state");
      finalHistory = await bridge("api/v1/history");
    } catch {
      /* return last known */
    }

    return NextResponse.json({
      ok: true,
      mode,
      assignments: agents.map((a) => ({
        id: a.id,
        role: a.role,
        provider_id: a.provider_id,
        model: a.model,
      })),
      results,
      state: finalState,
      history: finalHistory,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
