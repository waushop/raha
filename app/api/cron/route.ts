import { NextRequest, NextResponse } from "next/server";
import { runAllNudges } from "@/lib/nudges-db";
import { constantTimeEqual } from "@/lib/pin";

// External trigger for the hourly nudges (the in-process scheduler in
// instrumentation.ts already runs them; this is for a K8s CronJob or a
// manual kick). Protected by CRON_SECRET.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Header only (a query string would land in access logs); constant-time compare.
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given || !constantTimeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runAllNudges();
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
