import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const baseUrl = String(body.base_url || "").replace(/\/$/, "");
    const model = String(body.model || "");
    const apiKey = String(body.api_key || "");

    if (!baseUrl || !model || !apiKey) {
      return NextResponse.json({ ok: false, error: "base_url, model, and api_key required" }, { status: 400 });
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/methaneex-oss/multi-ai-bridge",
        "X-Title": "Multi-AI Bridge",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 16,
        temperature: 0,
      }),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 400) };
    }

    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.error ||
        data?.raw ||
        text.slice(0, 300) ||
        `HTTP ${res.status}`;
      return NextResponse.json({ ok: false, status: res.status, error: String(msg) });
    }

    const content = data?.choices?.[0]?.message?.content || "";
    return NextResponse.json({ ok: true, status: res.status, reply: content, message: "Works: ready" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
