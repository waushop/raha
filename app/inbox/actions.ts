"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseId, ValidationError } from "@/lib/validate";
import { pushConfigured, runNudges, sendPush, unreadCount } from "@/lib/nudges-db";

export async function getUnreadCount(): Promise<number> {
  const { workspaceId: ws } = await requireAuth();
  return unreadCount(ws);
}

export async function markRead(id: string): Promise<void> {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("UPDATE NOTIFICATION SET READ_AT = CURRENT_TIMESTAMP WHERE ID = ? AND WORKSPACE_ID = ? AND READ_AT IS NULL", [parseId(id), ws]);
  revalidatePath("/inbox");
}

export async function markAllRead(): Promise<void> {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("UPDATE NOTIFICATION SET READ_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = ? AND READ_AT IS NULL", [ws]);
  revalidatePath("/inbox");
}

export async function clearInbox(): Promise<void> {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("DELETE FROM NOTIFICATION WHERE WORKSPACE_ID = ? AND READ_AT IS NOT NULL", [ws]);
  revalidatePath("/inbox");
}

/** Evaluates today's nudges now (the "Check now" button). */
export async function checkNow(): Promise<ActionResult<{ created: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const fresh = await runNudges(ws);
    revalidatePath("/inbox");
    return { created: fresh.length };
  });
}

// ---------- web push ----------

export async function getPushConfig(): Promise<{ publicKey: string | null; devices: number }> {
  const { workspaceId: ws, userId } = await requireAuth();
  const [rows] = await db.execute("SELECT COUNT(*) AS N FROM PUSH_SUBSCRIPTION WHERE WORKSPACE_ID = ? AND USER_ID = ? AND DELETED_AT IS NULL", [ws, userId]);
  return { publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null, devices: (rows as { N: number }[])[0]?.N ?? 0 };
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<ActionResult> {
  const { workspaceId: ws, userId } = await requireAuth();
  return attempt(async () => {
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 2000) throw new ValidationError("Invalid subscription");
    if (!sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") throw new ValidationError("Invalid subscription keys");
    await db.execute(
      `INSERT INTO PUSH_SUBSCRIPTION (ID, WORKSPACE_ID, USER_ID, ENDPOINT, P256DH, AUTH, USER_AGENT, LAST_SEEN_AT) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(ENDPOINT, WORKSPACE_ID) DO UPDATE SET USER_ID = excluded.USER_ID, P256DH = excluded.P256DH, AUTH = excluded.AUTH,
         USER_AGENT = excluded.USER_AGENT, LAST_SEEN_AT = CURRENT_TIMESTAMP, DELETED_AT = NULL`,
      [randomUUID(), ws, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 200) ?? null],
    );
    return {};
  });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("UPDATE PUSH_SUBSCRIPTION SET DELETED_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = ? AND ENDPOINT = ?", [ws, String(endpoint)]);
}

export async function sendTestPush(): Promise<ActionResult<{ sent: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const sent = await sendPush(ws, { title: "Empty Wallet", body: "Push notifications are working on this device.", url: "/inbox" });
    return { sent };
  });
}
