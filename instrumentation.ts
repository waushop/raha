// Runs once per server start (Next.js instrumentation hook). Schedules the
// hourly nudge run in-process so production needs no external cron; set
// NUDGES=off to disable, NUDGE_INTERVAL_MIN to change the cadence.
// Bank sync (lib/banksync-db.ts) runs on its own timer every
// BANK_SYNC_INTERVAL_MIN (default 360 = 6 h); BANK_SYNC=off disables it, and
// it never starts when Enable Banking is neither configured nor mocked.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  scheduleNudges();
  await scheduleBankSync();
}

function scheduleNudges() {
  if (process.env.NUDGES === "off") return;
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

async function scheduleBankSync() {
  if (process.env.BANK_SYNC === "off") return;
  const g = globalThis as unknown as { __bankSyncTimer?: NodeJS.Timeout };
  if (g.__bankSyncTimer) return;
  const { bankMode } = await import("./lib/enablebanking");
  if (bankMode() === "off") return;
  const minutes = Math.max(30, Number(process.env.BANK_SYNC_INTERVAL_MIN ?? 360));
  const tick = async () => {
    try {
      const { syncAll } = await import("./lib/banksync-db");
      const r = await syncAll();
      if (r.connections > 0) console.log(`[bank] synced ${r.connections} connection(s): ${r.inserted} new row(s), ${r.failed} failed`);
    } catch (e) {
      console.error("[bank] sync failed:", (e as Error).message);
    }
  };
  g.__bankSyncTimer = setInterval(tick, minutes * 60_000);
  g.__bankSyncTimer.unref?.();
  setTimeout(tick, 120_000).unref?.();
}
