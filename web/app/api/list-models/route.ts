import { NextRequest, NextResponse } from "next/server";

/** List models for a provider. OpenRouter returns a rich catalog from one key. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const baseUrl = String(body.base_url || "").replace(/\/$/, "");
    const apiKey = String(body.api_key || "");
    const name = String(body.name || "").toLowerCase();

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "base_url and api_key required" }, { status: 400 });
    }

    // OpenRouter (and some compatible gateways) expose GET /models
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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
    const models = raw
      .map((m: any) => ({
        id: m.id || m.name,
        name: m.name || m.id,
        context: m.context_length || m.context || null,
        // OpenRouter pricing / modality hints when present
        modality: m.architecture?.modality || m.modality || null,
        prompt_price: m.pricing?.prompt || null,
        completion_price: m.pricing?.completion || null,
      }))
      .filter((m: any) => m.id)
      .slice(0, 400);

    // Capability tags for auto-assign (heuristic from model id)
    const tagged = models.map((m: any) => ({
      ...m,
      tags: inferTags(String(m.id), name),
    }));

    return NextResponse.json({ ok: true, count: tagged.length, models: tagged });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

function inferTags(id: string, provider: string): string[] {
  const s = id.toLowerCase();
  const tags: string[] = [];
  if (/code|coder|deepseek|qwen.*coder|starcoder|codellama|devstral/.test(s)) tags.push("code");
  if (/claude|gpt-4|gpt-5|o1|o3|gemini-2|gemini-1\.5-pro|sonnet|opus/.test(s)) tags.push("reasoning");
  if (/mini|flash|haiku|8b|7b|small|nano/.test(s)) tags.push("fast");
  if (/review|critique/.test(s)) tags.push("review");
  if (/grok/.test(s)) tags.push("reasoning");
  if (!tags.length) tags.push("general");
  if (provider.includes("openrouter")) tags.push("routed");
  return tags;
}
