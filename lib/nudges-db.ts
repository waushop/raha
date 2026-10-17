// Runs the nudges for a workspace: evaluates, writes new inbox rows (dedup
// by key), pushes them to subscribed browsers and emails the digest-type
// ones. Safe to call every hour; nothing repeats.
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import db from "./db";
import { addMonths, currentMonth } from "./months";
import { isoDate, upcoming } from "./subscriptions";
import { listSubscriptions } from "./subscriptions-db";
import { getPlan } from "./plan-db";
import { getCashflow } from "./cashflow-db";
import { mailConfigured, sendMail } from "./mailer";
import { evaluateNudges, type Nudge } from "./nudges";
import { CATEGORIES, type CategoryKey } from "@/types/expense";
import { addDays } from "./cashflow";

export type InboxItem = { ID: string; CREATED_AT: string; KIND: Nudge["kind"]; TITLE: string; BODY: string | null; URL: string | null; READ_AT: string | null };

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    vapidReady = true;
  }
  return true;
}

export async function listInbox(ws: string, limit = 50): Promise<InboxItem[]> {
  const [rows] = await db.execute("SELECT ID, CREATED_AT, KIND, TITLE, BODY, URL, READ_AT FROM NOTIFICATION WHERE WORKSPACE_ID = ? ORDER BY CREATED_AT DESC LIMIT ?", [ws, limit]);
  return rows as InboxItem[];
}

export async function unreadCount(ws: string): Promise<number> {
  const [rows] = await db.execute("SELECT COUNT(*) AS N FROM NOTIFICATION WHERE WORKSPACE_ID = ? AND READ_AT IS NULL", [ws]);
  return (rows as { N: number }[])[0]?.N ?? 0;
}

async function weekSummary(ws: string, today: string) {
  const from = addDays(today, -7);
  const [rows] = await db.execute(
    `SELECT KIND, CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS N FROM LEDGER
     WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND DAY IS NOT NULL
       AND (MONTH || '-' || printf('%02d', DAY)) > ? AND (MONTH || '-' || printf('%02d', DAY)) <= ?
     GROUP BY KIND, CATEGORY`, [ws, from, today],
  );
  const list = rows as { KIND: string; CATEGORY: string; TOTAL: number; N: number }[];
  const expenses = list.filter((r) => r.KIND === "expense");
  const top = [...expenses].sort((a, b) => b.TOTAL - a.TOTAL)[0];
  return {
    spent: expenses.reduce((s, r) => s + r.TOTAL, 0),
    income: list.filter((r) => r.KIND === "income").reduce((s, r) => s + r.TOTAL, 0),
    count: expenses.reduce((s, r) => s + r.N, 0),
    topCategory: top ? (CATEGORIES[top.CATEGORY as CategoryKey]?.label ?? top.CATEGORY) : null,
    topAmount: top?.TOTAL ?? 0,
  };
}

/** Evaluates and stores today's nudges for one workspace; returns the new ones. */
export async function runNudges(ws: string, today = isoDate(new Date())): Promise<Nudge[]> {
  const subs = await listSubscriptions(ws, today);
  const due = upcoming(
    subs.map((s) => ({ id: s.ID, name: s.NAME, amount: s.AMOUNT, status: s.STATUS, cadence: s.CADENCE, day: s.DAY, monthOfYear: s.MONTH_OF_YEAR, lastCharge: s.lastCharge })),
    today, 3,
  ).map((u) => ({ id: u.sub.id, name: u.sub.name, date: u.date, amount: u.amount }));
  const month = currentMonth();
  // The ledger owner's safe-to-spend buffer (household = whoever created it).
  const [ownerRows] = await db.execute("SELECT USER_ID FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? ORDER BY ROLE = 'owner' DESC LIMIT 1", [ws]);
  const ownerId = (ownerRows as { USER_ID: string }[])[0]?.USER_ID;
  const [plan, cash] = await Promise.all([getPlan(ws, month), ownerId ? getCashflow(ws, today, { userId: ownerId }) : getCashflow(ws, today)]);
  const week = await weekSummary(ws, today);
  const nudges = evaluateNudges({ today, subscriptions: subs, upcoming: due, plan: plan.lines.length ? plan : null, projection: cash.projection, buffer: cash.buffer, week });
  const fresh: Nudge[] = [];
  db.transaction((tx) => {
    for (const n of nudges) {
      const r = tx.run("INSERT OR IGNORE INTO NOTIFICATION (ID, WORKSPACE_ID, KIND, DEDUP_KEY, TITLE, BODY, URL) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), ws, n.kind, n.dedupKey, n.title, n.body, n.url]);
      if (r.affectedRows > 0) fresh.push(n);
    }
  });
  if (fresh.length) {
    await Promise.all([pushMany(ws, fresh), emailDigests(ws, fresh)]);
  }
  // keep the inbox bounded
  await db.execute("DELETE FROM NOTIFICATION WHERE WORKSPACE_ID = ? AND CREATED_AT < ? ", [ws, `${addMonths(month, -3)}-01`]);
  return fresh;
}

type PushRow = { ID: string; ENDPOINT: string; P256DH: string; AUTH: string };

export async function sendPush(ws: string, payload: { title: string; body: string; url: string }): Promise<number> {
  if (!ensureVapid()) return 0;
  const [rows] = await db.execute("SELECT ID, ENDPOINT, P256DH, AUTH FROM PUSH_SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]);
  let sent = 0;
  for (const r of rows as PushRow[]) {
    try {
      await webpush.sendNotification({ endpoint: r.ENDPOINT, keys: { p256dh: r.P256DH, auth: r.AUTH } }, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
      sent++;
      await db.execute("UPDATE PUSH_SUBSCRIPTION SET LAST_SEEN_AT = CURRENT_TIMESTAMP WHERE ID = ?", [r.ID]);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.execute("UPDATE PUSH_SUBSCRIPTION SET DELETED_AT = CURRENT_TIMESTAMP WHERE ID = ?", [r.ID]);
      else console.error("[push] failed:", (e as Error).message);
    }
  }
  return sent;
}

async function pushMany(ws: string, nudges: Nudge[]): Promise<void> {
  for (const n of nudges) await sendPush(ws, { title: n.title, body: n.body, url: n.url });
}

async function emailDigests(ws: string, nudges: Nudge[]): Promise<void> {
  const mailable = nudges.filter((n) => n.email);
  if (!mailable.length || !mailConfigured()) return;
  const [rows] = await db.execute(
    "SELECT u.EMAIL FROM WORKSPACE_MEMBER m JOIN USER u ON u.ID = m.USER_ID WHERE m.WORKSPACE_ID = ? AND u.DELETED_AT IS NULL AND u.EMAIL IS NOT NULL AND u.EMAIL_VERIFIED_AT IS NOT NULL", [ws],
  );
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  for (const { EMAIL } of rows as { EMAIL: string }[]) {
    for (const n of mailable) await sendMail(EMAIL, `Empty Wallet · ${n.title}`, `${n.body}\n\n${base}${n.url}`);
  }
}

/** Every workspace, for the scheduler and the cron endpoint. */
export async function runAllNudges(today = isoDate(new Date())): Promise<{ workspaces: number; created: number }> {
  const [rows] = await db.execute("SELECT ID FROM WORKSPACE");
  let created = 0;
  for (const { ID } of rows as { ID: string }[]) {
    try { created += (await runNudges(ID, today)).length; } catch (e) { console.error(`[nudges] ${ID}:`, (e as Error).message); }
  }
  return { workspaces: (rows as unknown[]).length, created };
}
