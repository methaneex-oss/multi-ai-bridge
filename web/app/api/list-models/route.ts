import { NextRequest, NextResponse } from "next/server";

/** List models for a provider. Marks free models and ranks by capability. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const baseUrl = String(body.base_url || "").replace(/\/$/, "");
    const apiKey = String(body.api_key || "");
    const name = String(body.name || "").toLowerCase();
    const freeOnly = !!body.free_only;
    const prefer = String(body.prefer || "balanced"); // code | analysis | balanced

    if (!baseUrl) {
      return NextResponse.json({ error: "base_url required" }, { status: 400 });
    }

    // OpenRouter public catalog works without a key; others need a key
    const isOpenRouter = baseUrl.includes("openrouter.ai");
    if (!apiKey && !isOpenRouter) {
      return NextResponse.json({ error: "api_key required for this provider" }, { status: 400 });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, {
      headers,
      cache: "no-store",
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: `Bad JSON from /models: ${text.slice(0, 200)}` }, { status: 502 });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error?.message || data?.error || text.slice(0, 300) },
        { status: res.status }
      );
    }

    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    let models = raw
      .map((m: any) => {
        const id = String(m.id || m.name || "");
        const promptPrice = m.pricing?.prompt != null ? Number(m.pricing.prompt) : null;
        const completionPrice = m.pricing?.completion != null ? Number(m.pricing.completion) : null;
        const free =
          id.endsWith(":free") ||
          id.includes("/free") ||
          (promptPrice === 0 && completionPrice === 0) ||
          // Groq / free-tier hosts often omit pricing
          (name.includes("groq") && !!id);
        return {
          id,
          name: m.name || id,
          context: m.context_length || m.context || null,
          modality: m.architecture?.modality || m.modality || null,
          prompt_price: promptPrice,
          completion_price: completionPrice,
          free,
          tags: inferTags(id, name),
        };
      })
      .filter((m: any) => m.id);

    if (freeOnly) {
      models = models.filter((m: any) => m.free);
    }

    models = models
      .map((m: any) => ({ ...m, score: rankScore(m, prefer) }))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 400);

    const recommended = models.filter((m: any) => m.free).slice(0, 12);

    return NextResponse.json({
      ok: true,
      count: models.length,
      models,
      recommended_free: recommended,
      prefer,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function inferTags(id: string, provider: string): string[] {
  const s = id.toLowerCase();
  const tags: string[] = [];
  if (/code|coder|devstral|starcoder|codellama|qwen.*coder|deepseek-coder|north.*code/.test(s))
    tags.push("code");
  if (/reason|r1|thinking|nemotron|opus|sonnet|pro|qwen3|gemma-4|deepseek-r|o1|o3/.test(s))
    tags.push("reasoning");
  if (/analysis|research|long|context/.test(s)) tags.push("analysis");
  if (/mini|flash|haiku|8b|7b|nano|small|lightning|fast/.test(s)) tags.push("fast");
  if (/review|critic|judge/.test(s)) tags.push("review");
  if (!tags.length) tags.push("general");
  if (provider.includes("deepseek")) tags.push("code", "reasoning");
  if (provider.includes("groq")) tags.push("fast");
  return Array.from(new Set(tags));
}

function rankScore(m: { id: string; tags?: string[]; free?: boolean; context?: number | null }, prefer: string): number {
  const id = m.id.toLowerCase();
  let s = 0;
  if (m.free) s += 5;
  const tags = m.tags || [];
  if (prefer === "code") {
    if (tags.includes("code")) s += 8;
    if (/coder|code|devstral|deepseek/.test(id)) s += 4;
  } else if (prefer === "analysis") {
    if (tags.includes("reasoning") || tags.includes("analysis")) s += 8;
    if (/reason|r1|thinking|nemotron|gemma-4|qwen/.test(id)) s += 4;
  } else {
    if (tags.includes("code")) s += 3;
    if (tags.includes("reasoning")) s += 3;
    if (tags.includes("general")) s += 1;
  }
  // Prefer larger / known solid free lines when present in live catalog
  if (/gemma-4|nemotron-3|deepseek|qwen3|llama-3\.3|llama-4/.test(id)) s += 3;
  if (/router\/free$|openrouter\/free/.test(id)) s += 2;
  if (m.context && m.context >= 32000) s += 1;
  // Soft-penalize tiny toy models for coding agents
  if (/1b|2b|3b|tiny|micro/.test(id) && prefer === "code") s -= 2;
  return s;
}
