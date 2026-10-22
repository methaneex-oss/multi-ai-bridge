import { NextRequest, NextResponse } from "next/server";
import { autoAssignAgents, DEFAULT_AGENTS, type AgentDef, type ProviderInfo } from "../../../lib/autoAssign";

const BRIDGE = (process.env.BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";

async function bridge(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  const res = await fetch(`${BRIDGE}/${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`Bridge ${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function chat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[]
) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
      "X-Title": "Multi-AI Bridge",
    },
    body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.3 }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || JSON.stringify(data).slice(0, 300));
  }
  return data?.choices?.[0]?.message?.content || "(empty)";
}

export async function POST(req: NextRequest) {
  if (!BRIDGE) {
    return NextResponse.json({ error: "Set BRIDGE_URL on UI service" }, { status: 500 });
  }

  let body: {
    providers?: ProviderInfo[];
    agents?: AgentDef[];
    auto_assign?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch { /* */ }

  let providers = (body.providers || []).filter((p) => p.enabled && p.api_key && p.base_url);
  if (!providers.length && process.env.OPENROUTER_API_KEY) {
    providers = [
      {
        id: "openrouter",
        name: "openrouter",
        enabled: true,
        api_key: process.env.OPENROUTER_API_KEY,
        base_url: "https://openrouter.ai/api/v1",
        models: [{ id: process.env.DEFAULT_MODEL || "deepseek/deepseek-chat", tags: ["general", "code"] }],
      },
    ];
  }
  if (!providers.length) {
    return NextResponse.json(
      { error: "No enabled providers with keys. Add OpenRouter (or others) under Providers." },
      { status: 400 }
    );
  }

  let agents = body.agents?.length ? body.agents : DEFAULT_AGENTS;

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
      agents = autoAssignAgents(agents, providers as ProviderInfo[], context);
    }

    // Ensure every agent has provider+model
    agents = agents.map((a) => {
      if (a.provider_id && a.model) return a;
      const p = providers[0];
      const model =
        (p.models && p.models[0]?.id) ||
        process.env.DEFAULT_MODEL ||
        "deepseek/deepseek-chat";
      return { ...a, provider_id: p.id, model };
    });

    let history = await bridge("api/v1/history");
    const results: { agent: string; role: string; model: string; ok: boolean; detail?: string }[] = [];

    for (const agent of agents) {
      const prov = providers.find((p) => p.id === agent.provider_id) || providers[0];
      const model = agent.model!;
      const hist = (Array.isArray(history) ? history : [])
        .slice(0, 8)
        .map((h: any) => `- [${h.role}] ${String(h.content || "").slice(0, 350)}`)
        .join("\n");

      const messages = [
        {
          role: "system",
          content: `You are ${agent.role} (${agent.id}) on a multi-agent bridge.\n${state.instructions || ""}`,
        },
        {
          role: "user",
          content: `Task: ${state.task_title}\n${state.task_description || ""}\nStatus: ${state.current_status}\n\nRecent:\n${hist || "(none)"}\n\nAs ${agent.role}, produce the next useful contribution.`,
        },
      ];

      try {
        const content = await chat(prov.base_url, prov.api_key, model, messages);
        let ctype = "update";
        const r = agent.role.toLowerCase();
        if (r.includes("architect") || r.includes("plan")) ctype = "plan";
        else if (r.includes("coder") || r.includes("engineer")) ctype = "code";
        else if (r.includes("review")) ctype = "review";

        await bridge("api/v1/contribute", {
          method: "POST",
          body: JSON.stringify({
            agent_name: agent.id,
            role: agent.role,
            content,
            contribution_type: ctype,
            metadata: { model, provider: prov.name },
          }),
        });
        results.push({ agent: agent.id, role: agent.role, model, ok: true });
        history = await bridge("api/v1/history");
        state = await bridge("api/v1/state");
      } catch (e: any) {
        results.push({
          agent: agent.id,
          role: agent.role,
          model,
          ok: false,
          detail: e?.message || String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      assignments: agents.map((a) => ({
        id: a.id,
        role: a.role,
        provider_id: a.provider_id,
        model: a.model,
      })),
      results,
      state: await bridge("api/v1/state"),
      history: await bridge("api/v1/history"),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
