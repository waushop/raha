// Runs once per server start (Next.js instrumentation hook). Schedules the
// hourly nudge run in-process so production needs no external cron; set
// NUDGES=off to disable, NUDGE_INTERVAL_MIN to change the cadence.
// Bank sync (lib/banksync-db.ts) runs on its own timer every
// BANK_SYNC_INTERVAL_MIN (default 360 = 6 h); BANK_SYNC=off disables it, and
// it never starts when Enable Banking is neither configured nor mocked.
export async function register() {
  // The branch is dropped from the Edge bundle, so Node-only modules stay out of it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSchedulers } = await import("./instrumentation-node");
    await startSchedulers();
  }
}
