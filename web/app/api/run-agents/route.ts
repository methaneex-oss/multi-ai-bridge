import { NextRequest, NextResponse } from "next/server";

const BRIDGE = (process.env.BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  enabled: boolean;
  role?: string;
};

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

async function chat(p: Provider, messages: { role: string; content: string }[]) {
  const base = p.base_url.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.api_key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
      "X-Title": "Multi-AI Bridge",
    },
    body: JSON.stringify({ model: p.model, messages, max_tokens: 2048, temperature: 0.3 }),
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

  let body: { providers?: Provider[] } = {};
  try {
    body = await req.json();
  } catch { /* ok */ }

  const providers = (body.providers || []).filter((p) => p.enabled && p.api_key && p.base_url && p.model);
  if (!providers.length) {
    // fallback: env OpenRouter single provider
    const or = process.env.OPENROUTER_API_KEY;
    if (or) {
      providers.push({
        id: "openrouter",
        name: "openrouter",
        base_url: "https://openrouter.ai/api/v1",
        model: process.env.DEFAULT_MODEL || "deepseek/deepseek-chat",
        api_key: or,
        enabled: true,
        role: "Agent",
      });
    }
  }
  if (!providers.length) {
    return NextResponse.json(
      { error: "No enabled providers. Add one under Providers and Test it, or set OPENROUTER_API_KEY." },
      { status: 400 }
    );
  }

  try {
    let state = await bridge("api/v1/state");
    if (!state.task_title) {
      state = await bridge("api/v1/task", {
        method: "POST",
        body: JSON.stringify({
          title: "Coordinate and advance the active project",
          description: "Multi-agent team working from shared bridge state.",
          instructions: "Prefer concrete next steps. Record decisions and questions.",
          goals: ["Clear next step"],
          constraints: ["Use shared bridge only"],
        }),
      });
    }
    let history = await bridge("api/v1/history");
    const results: { name: string; ok: boolean; detail?: string }[] = [];

    for (const p of providers) {
      const role = p.role || p.name;
      const hist = (Array.isArray(history) ? history : [])
        .slice(0, 8)
        .map((h: any) => `- [${h.role}] ${String(h.content || "").slice(0, 350)}`)
        .join("\n");
      const messages = [
        {
          role: "system",
          content: `You are ${role} on a multi-agent bridge.\n${state.instructions || ""}`,
        },
        {
          role: "user",
          content: `Task: ${state.task_title}\n${state.task_description || ""}\nStatus: ${state.current_status}\n\nRecent:\n${hist || "(none)"}\n\nProduce the next useful contribution as ${role}.`,
        },
      ];
      try {
        const content = await chat(p, messages);
        await bridge("api/v1/contribute", {
          method: "POST",
          body: JSON.stringify({
            agent_name: p.name,
            role,
            content,
            contribution_type: "update",
            metadata: { model: p.model, provider: p.name },
          }),
        });
        results.push({ name: p.name, ok: true });
        history = await bridge("api/v1/history");
        state = await bridge("api/v1/state");
      } catch (e: any) {
        results.push({ name: p.name, ok: false, detail: e?.message || String(e) });
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      state: await bridge("api/v1/state"),
      history: await bridge("api/v1/history"),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
