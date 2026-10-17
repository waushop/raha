import { NextRequest, NextResponse } from "next/server";
import { runAllNudges } from "@/lib/nudges-db";

// External trigger for the hourly nudges (the in-process scheduler in
// instrumentation.ts already runs them; this is for a K8s CronJob or a
// manual kick). Protected by CRON_SECRET.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("secret");
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runAllNudges();
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
