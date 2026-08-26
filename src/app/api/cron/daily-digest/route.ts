import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
  // Accept either Authorization: Bearer <secret> or x-cron-secret
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  const xCron = req.headers.get("x-cron-secret") ?? "";

  const candidate = provided || xCron;
  if (!candidate || !cronSecret || !constantTimeEqual(candidate, cronSecret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Guard: if active driver is pg_cron, fallback is dormant but still respond 200
  // (we still run to keep idempotency safe; no double-send due to notification_log unique indexes)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const edgeUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/send-whatsapp` : "";

  if (!edgeUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "missing supabase config" }, { status: 500 });
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceRoleKey}`,
    "x-cron-secret": cronSecret,
  };

  const results: Record<string, unknown>[] = [];
  for (const kind of ["absence", "birthday"] as const) {
    try {
      const res = await fetch(edgeUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind, triggered_by: "cron" }),
      });
      const body = await res.json().catch(() => ({}));
      results.push({ kind, status: res.status, body });
    } catch (err) {
      results.push({ kind, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Aggregate counts for monitoring strip
  const aggregated = {
    ok: true,
    driver: "vercel",
    results,
  };

  return NextResponse.json(aggregated, { status: 200 });
}

// Allow GET for manual testing with same auth (Vercel Cron uses GET by default if not specified)
export async function GET(req: Request) {
  return POST(req);
}
