import { NextRequest, NextResponse } from "next/server";
import {
  autoAssignAgents,
  DEFAULT_AGENTS,
  type AgentDef,
  type ProviderInfo,
} from "../../../lib/autoAssign";

export const maxDuration = 120;

const BRIDGE = (process.env.BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";

async function bridge(path: string, init?: RequestInit) {
  if (!BRIDGE) throw new Error("BRIDGE_URL is not set on this service");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${BRIDGE}/${path}`, {
        ...init,
        headers,
        cache: "no-store",
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        lastErr = new Error(`Bridge ${path} ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Bridge ${path} ${res.status}: ${text.slice(0, 280)}`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.3,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        (typeof data?.error === "string" ? data.error : null) ||
        JSON.stringify(data).slice(0, 280);
      throw new Error(msg || `LLM HTTP ${res.status}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (content == null || content === "") {
      throw new Error("Empty model response");
    }
    return String(content);
  } finally {
    clearTimeout(timer);
  }
}

function contributionType(role: string) {
  const r = role.toLowerCase();
  if (r.includes("architect") || r.includes("plan")) return "plan";
  if (r.includes("coder") || r.includes("engineer") || r.includes("build")) return "code";
  if (r.includes("review") || r.includes("critic")) return "review";
  if (r.includes("test")) return "test";
  return "update";
}

function resolveProviders(bodyProviders: ProviderInfo[] | undefined): ProviderInfo[] {
  let providers = (bodyProviders || []).filter(
    (p) => p && p.enabled && p.api_key && p.base_url
  );
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
  return providers;
}

async function runOneAgent(
  agent: AgentDef,
  providers: ProviderInfo[],
  state: any,
  history: any[]
) {
  const prov =
    providers.find((p) => p.id === agent.provider_id) || providers[0];
  if (!prov) throw new Error("No provider available");
  const model =
    agent.model ||
    prov.models?.[0]?.id ||
    process.env.DEFAULT_MODEL ||
    "deepseek/deepseek-chat";

  const hist = (Array.isArray(history) ? history : [])
    .slice(0, 8)
    .map(
      (h: any) =>
        `- [${h.role || h.agent_name}] ${String(h.content || "").slice(0, 350)}`
    )
    .join("\n");

  const messages = [
    {
      role: "system",
      content: `You are ${agent.role} (${agent.id}) on a multi-agent bridge.\n${state.instructions || ""}`,
    },
    {
      role: "user",
      content: `Task: ${state.task_title || "(none)"}\n${state.task_description || ""}\nStatus: ${state.current_status || ""}\n\nRecent contributions:\n${hist || "(none)"}\n\nAs ${agent.role}, produce the next useful contribution. Be concrete.`,
    },
  ];

  const content = await chat(prov.base_url, prov.api_key, model, messages);
  await bridge("api/v1/contribute", {
    method: "POST",
    body: JSON.stringify({
      agent_name: agent.id,
      role: agent.role,
      content,
      contribution_type: contributionType(agent.role),
      metadata: {
        model,
        provider: prov.name || prov.id,
        // reserved for future tools / skills / build jobs
        run_mode: "bridge-v1",
      },
    }),
  });

  return { agent: agent.id, role: agent.role, model, provider: prov.id, ok: true as const };
}

export async function POST(req: NextRequest) {
  try {
    if (!BRIDGE) {
      return NextResponse.json(
        { error: "Set BRIDGE_URL on the UI service (Render Environment)" },
        { status: 500 }
      );
    }

    let body: {
      providers?: ProviderInfo[];
      agents?: AgentDef[];
      auto_assign?: boolean;
      /** sequential (default): each agent sees prior posts. parallel: all at once. */
      mode?: "sequential" | "parallel";
    } = {};
    try {
      body = await req.json();
    } catch {
      /* empty body ok */
    }

    const mode = body.mode === "parallel" ? "parallel" : "sequential";
    const providers = resolveProviders(body.providers);
    if (!providers.length) {
      return NextResponse.json(
        {
          error:
            "No enabled providers with API keys. Add OpenRouter under Providers, or set OPENROUTER_API_KEY on the service.",
        },
        { status: 400 }
      );
    }

    let agents = body.agents?.length ? body.agents : DEFAULT_AGENTS;

    let state = await bridge("api/v1/state");
    if (!state?.task_title) {
      state = await bridge("api/v1/task", {
        method: "POST",
        body: JSON.stringify({
          title: "Coordinate and advance the active project",
          description: "Multi-agent team on shared bridge state.",
          instructions:
            "Concrete next steps. Record decisions and open questions on the bridge.",
          goals: ["Clear next step"],
          constraints: ["Shared bridge only"],
        }),
      });
    }

    const context = [
      state.task_title,
      state.task_description,
      state.instructions,
      ...(state.goals || []),
    ]
      .filter(Boolean)
      .join(" ");

    if (body.auto_assign !== false) {
      agents = autoAssignAgents(agents, providers, context);
    }

    agents = agents.map((a) => {
      if (a.provider_id && a.model) return a;
      const p = providers.find((x) => x.id === a.provider_id) || providers[0];
      const model =
        a.model ||
        p.models?.[0]?.id ||
        process.env.DEFAULT_MODEL ||
        "deepseek/deepseek-chat";
      return { ...a, provider_id: p.id, model };
    });

    let history = await bridge("api/v1/history");
    if (!Array.isArray(history)) history = [];

    const results: {
      agent: string;
      role: string;
      model: string;
      provider?: string;
      ok: boolean;
      detail?: string;
    }[] = [];

    if (mode === "parallel") {
      // True simultaneous calls; each agent sees the same snapshot (not each other mid-turn).
      const settled = await Promise.allSettled(
        agents.map((agent) => runOneAgent(agent, providers, state, history))
      );
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const agent = agents[i];
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          results.push({
            agent: agent.id,
            role: agent.role,
            model: agent.model || "",
            ok: false,
            detail: s.reason?.message || String(s.reason),
          });
        }
      }
    } else {
      // Sequential: each agent can read prior contributions in this run.
      for (const agent of agents) {
        try {
          const r = await runOneAgent(agent, providers, state, history);
          results.push(r);
          history = await bridge("api/v1/history");
          if (!Array.isArray(history)) history = [];
          state = await bridge("api/v1/state");
        } catch (e: any) {
          results.push({
            agent: agent.id,
            role: agent.role,
            model: agent.model || "",
            ok: false,
            detail: e?.message || String(e),
          });
          // continue other agents — do not abort the whole run
        }
      }
    }

    const finalState = await bridge("api/v1/state");
    const finalHistory = await bridge("api/v1/history");

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
      history: Array.isArray(finalHistory) ? finalHistory : [],
      // extension hooks for future features (tools, jobs, skills)
      meta: {
        version: 1,
        extensible: true,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
