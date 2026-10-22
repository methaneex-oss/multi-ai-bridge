import { NextRequest, NextResponse } from "next/server";

const BRIDGE = (process.env.BRIDGE_URL || process.env.NEXT_PUBLIC_BRIDGE_URL || "").replace(/\/$/, "");
const API_KEY = process.env.BRIDGE_API_KEY || "";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      // Retry cold-start / gateway errors
      if ((res.status === 502 || res.status === 503 || res.status === 504) && i < attempts - 1) {
        await sleep(1500 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr || new Error("bridge unreachable");
}

async function proxy(req: NextRequest, path: string[]) {
  if (!BRIDGE) {
    return NextResponse.json(
      {
        error: "BRIDGE_URL_missing",
        detail: "Set BRIDGE_URL=https://multi-ai-bridge.onrender.com on this UI service in Render Environment.",
      },
      { status: 500 }
    );
  }

  const targetPath = path.join("/");
  const url = new URL(req.url);
  const target = `${BRIDGE}/${targetPath}${url.search}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res = await fetchWithRetry(target, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "bridge_unreachable",
        detail: e?.message || String(e),
        target: BRIDGE,
        hint: "API may be waking from free-tier sleep. Wait 30s and refresh.",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    },
  });
}
