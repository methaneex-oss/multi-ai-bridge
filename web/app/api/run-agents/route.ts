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

function buildMessages(agent: AgentDef, state: any, history: any[], pack: string) {
  const hist = (Array.isArray(history) ? history : [])
    .slice(0, 8)
    .map((h: any) => `- [${h.role}] ${String(h.content || "").slice(0, 350)}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        `You are ${agent.role} (${agent.id}) on a multi-agent engineering bridge.\n` +
        `Follow project rules and training data over guesses.\n` +
        (pack ? `\n${pack.slice(0, 20000)}\n` : `\n${state.instructions || ""}\n`),
    },
    {
      role: "user",
      content:
        `Current task: ${state.task_title || "(none)"}\n${state.task_description || ""}\n` +
        `Status: ${state.current_status || ""}\n\n` +
        `Recent agent posts:\n${hist || "(none)"}\n\n` +
        `As ${agent.role}, produce the next useful contribution grounded in the project knowledge above.`,
    },
  ];
}

async function runOne(
  agent: AgentDef,
  providers: ProviderInfo[],
  state: any,
  history: any[],
  pack: string
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
    const content = await chat(
      prov.base_url,
      prov.api_key,
      model,
      buildMessages(agent, state, history, pack)
    );
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
    mode?: "sequential" | "parallel";
    project_id?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }

  try {
    let state = await bridge("api/v1/state");
    let history = await bridge("api/v1/history");

    const pid = body.project_id || state.project_id || "";
    let pack = "";
    try {
      const ctx = await bridge(`api/v1/context${pid ? `?project_id=${encodeURIComponent(pid)}` : ""}`);
      pack = String(ctx.pack || "");
    } catch {
      pack = [state.instructions, state.task_title, state.task_description].filter(Boolean).join("\n");
    }

    let agents = body.agents?.length ? body.agents : DEFAULT_AGENTS;
    const providers = (body.providers || []).filter((p) => p.enabled && p.api_key);

    if (body.auto_assign !== false && providers.length) {
      const ctx =
        pack.slice(0, 1500) ||
        [state.task_title, state.task_description, state.instructions].filter(Boolean).join(" ");
      agents = autoAssignAgents(agents, providers, ctx || "general project");
    }

    const mode = body.mode === "parallel" ? "parallel" : "sequential";
    const results: any[] = [];

    if (mode === "parallel") {
      const settled = await Promise.allSettled(
        agents.map((a) => runOne(a, providers, state, history, pack))
      );
      for (const s of settled) {
        results.push(s.status === "fulfilled" ? s.value : { ok: false, detail: String(s.reason) });
      }
    } else {
      for (const a of agents) {
        const r = await runOne(a, providers, state, history, pack);
        results.push(r);
        if (r.ok) {
          try {
            history = await bridge("api/v1/history");
            state = await bridge("api/v1/state");
          } catch {
            /* */
          }
        }
      }
    }

    try {
      state = await bridge("api/v1/state");
      history = await bridge("api/v1/history");
    } catch {
      /* */
    }

    return NextResponse.json({
      ok: true,
      mode,
      results,
      assignments: agents.map((a) => ({
        id: a.id,
        role: a.role,
        provider_id: a.provider_id,
        model: a.model,
      })),
      state,
      history,
      used_project_context: !!pack,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
