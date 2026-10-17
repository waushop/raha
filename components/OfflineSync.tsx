"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { createExpense } from "@/app/actions";
import { QUEUE_CHANGED_EVENT, listQueued, replayQueue } from "@/lib/offline-queue";
import { useToast } from "./Toast";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Shows an "Offline" pill while the browser has no network, and replays
 * entries queued offline (lib/offline-queue.ts) on start and whenever the
 * connection comes back.
 */
export default function OfflineSync() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [queued, setQueued] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { show, showError } = useToast();

  useEffect(() => {
    const refresh = () => { listQueued().then((q) => setQueued(q.length)).catch(() => {}); };
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, []);

  // Replay on start and on reconnect. Not on /login: createExpense needs a session.
  useEffect(() => {
    if (!online || pathname === "/login") return;
    let cancelled = false;
    replayQueue(createExpense)
      .then(({ synced, failed }) => {
        if (cancelled) return;
        if (synced > 0) {
          show(`${synced} offline ${synced === 1 ? "entry" : "entries"} synced`);
          router.refresh();
        }
        if (failed > 0) showError(`${failed} offline ${failed === 1 ? "entry was" : "entries were"} rejected and dropped`);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [online, pathname, router, show, showError]);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed right-3 z-[60] inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-[#1a1a2e]/90 px-3 py-1 text-[11px] font-bold text-amber-300 shadow-lg backdrop-blur animate-fade-in pointer-events-none"
      style={{ top: "calc(var(--sat, 0px) + 0.5rem)" }}
    >
      <WifiOff size={12} />
      Offline{queued > 0 ? ` · ${queued} queued` : ""}
    </div>
  );
}
