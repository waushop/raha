// Client-only queue for entries added while offline. Entries live in
// IndexedDB until components/OfflineSync.tsx replays them through the
// createExpense server action. Every IndexedDB call is wrapped so a browser
// without it (private mode, old WebView) just loses the offline fallback.

export type QueuedEntry = {
  id: string;
  name: string;
  amount: string;
  kind: string;
  tags: string;
  category: string;
  month: string;
  date: string;
  // Extra fields from the full add form, so nothing typed there is lost.
  group_id: string;
  notes: string;
  is_recurring: string;
  goal_id: string;
  paid_by: string;
  queuedAt: number;
};

const DB_NAME = "raha-offline";
const STORE = "entries";
const FIELDS = ["name", "amount", "kind", "tags", "category", "month", "date", "group_id", "notes", "is_recurring", "goal_id", "paid_by"] as const;
export const QUEUE_CHANGED_EVENT = "offline-queue-changed";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** True when a failed server action call looks like "no network" rather than a server error. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError && /fetch|network|load failed|connection/i.test(e.message);
}

/** Saves the entry's fields from a create form; false when IndexedDB isn't usable. */
export async function enqueue(data: FormData): Promise<boolean> {
  const entry = { id: crypto.randomUUID(), queuedAt: Date.now() } as QueuedEntry;
  for (const f of FIELDS) entry[f] = String(data.get(f) ?? "");
  try {
    await withStore("readwrite", (s) => s.put(entry));
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export async function listQueued(): Promise<QueuedEntry[]> {
  try {
    const all = await withStore<QueuedEntry[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedEntry[]>);
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } catch {
    return [];
  }
}

export async function removeQueued(id: string): Promise<void> {
  try { await withStore("readwrite", (s) => s.delete(id)); } catch { /* ignore */ }
}

export function toFormData(entry: QueuedEntry): FormData {
  const data = new FormData();
  for (const f of FIELDS) if (entry[f]) data.set(f, entry[f]);
  return data;
}

type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Submits a new entry, or queues it when the network is down. "queued" means
 * it was stored for later; anything else is the action's own result.
 */
export async function submitOrQueue<R extends SendResult>(send: (data: FormData) => Promise<R>, data: FormData): Promise<R | "queued" | "lost"> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return (await enqueue(data)) ? "queued" : "lost";
  try {
    return await send(data);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return (await enqueue(data)) ? "queued" : "lost";
  }
}

/**
 * Replays queued entries oldest first. Stops at the first network failure
 * (the rest stay queued); an entry the server rejects as invalid is dropped
 * and counted in `failed`. One replay at a time across tabs (Web Locks when
 * available, so two tabs can't post the same entry twice).
 */
export async function replayQueue(send: (data: FormData) => Promise<SendResult>): Promise<{ synced: number; failed: number }> {
  const run = async () => {
    let synced = 0;
    let failed = 0;
    for (const entry of await listQueued()) {
      let res: SendResult;
      try {
        res = await send(toFormData(entry));
      } catch {
        break; // offline again or signed out: keep the rest for later
      }
      await removeQueued(entry.id);
      if (res.ok) synced++; else failed++;
    }
    if (synced + failed > 0) window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    return { synced, failed };
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks) return locks.request("raha-offline-replay", { ifAvailable: true }, (lock) => (lock ? run() : { synced: 0, failed: 0 }));
  return run();
}
