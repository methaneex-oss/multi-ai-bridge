import { NextRequest, NextResponse } from "next/server";

/**
 * Live free-model recommendations (not a static list).
 * Pulls OpenRouter public /models catalog and ranks free entries for code/analysis.
 */
export async function GET(req: NextRequest) {
  try {
    const prefer = req.nextUrl.searchParams.get("prefer") || "balanced";
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Could not parse OpenRouter catalog" }, { status: 502 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: text.slice(0, 200) }, { status: res.status });
    }

    const raw = Array.isArray(data?.data) ? data.data : [];
    const free = raw
      .map((m: any) => {
        const id = String(m.id || "");
        const promptPrice = m.pricing?.prompt != null ? Number(m.pricing.prompt) : null;
        const completionPrice = m.pricing?.completion != null ? Number(m.pricing.completion) : null;
        const isFree =
          id.endsWith(":free") ||
          (promptPrice === 0 && completionPrice === 0);
        if (!isFree || !id) return null;
        const tags = tagsFor(id);
        return {
          id,
          name: m.name || id,
          context: m.context_length || null,
          free: true,
          tags,
          score: score(id, tags, prefer, m.context_length),
          provider_hint: "openrouter",
          base_url: "https://openrouter.ai/api/v1",
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score);

    const top = free.slice(0, 15);
    const byRole = {
      coder: free.filter((m: any) => m.tags.includes("code") || m.score > 0).slice(0, 5),
      analysis: free.filter((m: any) => m.tags.includes("reasoning") || m.tags.includes("analysis")).slice(0, 5),
      fast: free.filter((m: any) => m.tags.includes("fast")).slice(0, 5),
    };

    return NextResponse.json({
      ok: true,
      updated_at: new Date().toISOString(),
      source: "openrouter.ai/api/v1/models (live)",
      prefer,
      count: free.length,
      recommended: top,
      by_role: byRole,
      note: "Rankings change as OpenRouter updates free models. Add your OpenRouter key, then pick one of these.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function tagsFor(id: string): string[] {
  const s = id.toLowerCase();
  const tags: string[] = [];
  if (/code|coder|devstral|north.*code|starcoder/.test(s)) tags.push("code");
  if (/reason|r1|thinking|nemotron|gemma-4|qwen|deepseek/.test(s)) tags.push("reasoning");
  if (/analysis|research/.test(s)) tags.push("analysis");
  if (/mini|flash|nano|small|lightning|2\.6b|8b|7b/.test(s)) tags.push("fast");
  if (!tags.length) tags.push("general");
  return Array.from(new Set(tags));
}

function score(id: string, tags: string[], prefer: string, context?: number): number {
  const s = id.toLowerCase();
  let n = 10;
  if (prefer === "code") {
    if (tags.includes("code")) n += 10;
    if (/coder|code|deepseek|devstral|north/.test(s)) n += 6;
  } else if (prefer === "analysis") {
    if (tags.includes("reasoning")) n += 10;
    if (/nemotron|gemma-4|qwen|thinking|r1/.test(s)) n += 6;
  } else {
    if (tags.includes("code")) n += 4;
    if (tags.includes("reasoning")) n += 4;
  }
  if (/gemma-4-31b|nemotron-3-super|nemotron-3-ultra|qwen3|deepseek/.test(s)) n += 5;
  if (context && context >= 32000) n += 2;
  if (/1b|2b|tiny|safety|content-safety/.test(s)) n -= 4;
  return n;
}
