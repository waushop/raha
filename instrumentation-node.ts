// Node-only part of the instrumentation hook (see instrumentation.ts). Kept in
// its own module so the Edge bundle never sees node:crypto / node:sqlite.
export async function startSchedulers() {
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
