// Runs once per server start (Next.js instrumentation hook). Schedules the
// hourly nudge run in-process so production needs no external cron; set
// NUDGES=off to disable, NUDGE_INTERVAL_MIN to change the cadence.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NUDGES === "off") return;
  const g = globalThis as unknown as { __nudgeTimer?: NodeJS.Timeout };
  if (g.__nudgeTimer) return;
  const minutes = Math.max(5, Number(process.env.NUDGE_INTERVAL_MIN ?? 60));
  const tick = async () => {
    try {
      const { runAllNudges } = await import("./lib/nudges-db");
      const r = await runAllNudges();
      if (r.created > 0) console.log(`[nudges] ${r.created} new across ${r.workspaces} workspace(s)`);
    } catch (e) {
      console.error("[nudges] run failed:", (e as Error).message);
    }
  };
  g.__nudgeTimer = setInterval(tick, minutes * 60_000);
  g.__nudgeTimer.unref?.();
  setTimeout(tick, 90_000).unref?.();
}
