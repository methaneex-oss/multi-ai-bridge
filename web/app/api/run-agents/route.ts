import { NextRequest, NextResponse } from "next/server";

const BRIDGE = (process.env.BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";
const OPENROUTER = process.env.OPENROUTER_API_KEY || "";

type AgentDef = { id: string; role: string; model: string; temperature?: number };

const DEFAULT_AGENTS: AgentDef[] = [
  { id: "architect", role: "Architect", model: "anthropic/claude-sonnet-4", temperature: 0.3 },
  { id: "coder", role: "Coder", model: "deepseek/deepseek-chat", temperature: 0.2 },
  { id: "reviewer", role: "Reviewer", model: "openai/gpt-4o-mini", temperature: 0.2 },
];

function agentsFromEnv(): AgentDef[] {
  const raw = process.env.AGENTS_JSON;
  if (!raw) return DEFAULT_AGENTS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* ignore */ }
  return DEFAULT_AGENTS;
}

async function bridge(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  const res = await fetch(`${BRIDGE}/${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`Bridge ${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function openRouterChat(model: string, messages: { role: string; content: string }[], temperature: number) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
      "X-Title": "Multi-AI Bridge",
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 2048 }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data?.choices?.[0]?.message?.content || "(empty response)";
}

export async function POST(req: NextRequest) {
  if (!BRIDGE) {
    return NextResponse.json({ error: "Set BRIDGE_URL on this service" }, { status: 500 });
  }
  if (!OPENROUTER) {
    return NextResponse.json(
      {
        error: "Set OPENROUTER_API_KEY on the UI service (Render Environment)",
        hint: "One OpenRouter key runs all models listed in the agent team.",
      },
      { status: 500 }
    );
  }

  let body: { agentIds?: string[] } = {};
  try {
    body = await req.json();
  } catch { /* empty body ok */ }

  try {
    let state = await bridge("api/v1/state");
    if (!state.task_title) {
      state = await bridge("api/v1/task", {
        method: "POST",
        body: JSON.stringify({
          title: "Coordinate and advance the active project",
          description:
            "Multi-agent team: inspect shared state, propose the next useful step, post concrete contributions.",
          instructions:
            "Use the shared bridge only. Prefer smallest vertical slice. Record decisions and open questions.",
          goals: ["Clear next step", "Documented decisions"],
          constraints: ["No private unshared state"],
        }),
      });
    }

    const history = await bridge("api/v1/history");
    const agents = agentsFromEnv().filter((a) => !body.agentIds || body.agentIds.includes(a.id));
    const results: { id: string; role: string; ok: boolean; detail?: string }[] = [];

    for (const agent of agents) {
      const histLines = (Array.isArray(history) ? history : [])
        .slice(0, 10)
        .map(
          (h: any) =>
            `- [${h.role}/${h.agent_name}] (${h.contribution_type}): ${String(h.content || "").slice(0, 400)}`
        )
        .join("\n");

      const messages = [
        {
          role: "system",
          content: [
            `You are an AI agent with role: ${agent.role}.`,
            "You coordinate via a shared multi-agent bridge. Respect shared state.",
            state.instructions
              ? `\n=== PROJECT RULES ===\n${state.instructions}`
              : "",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Task: ${state.task_title}\n${state.task_description || ""}\nGoals: ${JSON.stringify(
            state.goals || []
          )}\nStatus: ${state.current_status}\nOpen questions: ${JSON.stringify(
            state.open_questions || []
          )}\n\nRecent contributions:\n${histLines || "(none)"}\n\nAs ${agent.role}, produce the next useful contribution. Be concrete.`,
        },
      ];

      try {
        const content = await openRouterChat(agent.model, messages, agent.temperature ?? 0.3);
        let ctype = "update";
        const r = agent.role.toLowerCase();
        if (r.includes("architect")) ctype = "plan";
        else if (r.includes("coder") || r.includes("engineer")) ctype = "code";
        else if (r.includes("review")) ctype = "review";

        await bridge("api/v1/contribute", {
          method: "POST",
          body: JSON.stringify({
            agent_name: agent.id,
            role: agent.role,
            content,
            contribution_type: ctype,
            metadata: { model: agent.model, source: "ui-run-agents" },
          }),
        });
        results.push({ id: agent.id, role: agent.role, ok: true });
        // refresh history for next agent
        state = await bridge("api/v1/state");
      } catch (e: any) {
        results.push({ id: agent.id, role: agent.role, ok: false, detail: e?.message || String(e) });
      }
    }

    const finalState = await bridge("api/v1/state");
    const finalHistory = await bridge("api/v1/history");
    return NextResponse.json({ ok: true, results, state: finalState, history: finalHistory });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
