"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { PIN_REGEX, createUserWithWorkspace, hashPin, pinTaken, requireAuth } from "@/lib/auth";
import { parseId, parseName } from "@/lib/validate";
import type { ActionResult } from "@/app/actions";
import { unlock } from "@/lib/ratelimit";
import { pinWeakness } from "@/lib/pin-policy";
import { createChallenge, forgetAllDevices, forgetDevice, latestChallengeId, verifyChallenge } from "@/lib/twofa";
import { mailConfigured, sendMail } from "@/lib/mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin-only user management. Every user gets their own workspace; removing
// a user keeps their data (soft delete) so it can be restored by hand.

async function requireAdmin() {
  const ctx = await requireAuth();
  if (!ctx.isAdmin) throw new Error("Admins only");
  return ctx;
}

export async function createUser(formData: FormData): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  let name: string;
  try { name = parseName(formData.get("name"), "Name", 40); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const pin = String(formData.get("pin") ?? "");
  if (!PIN_REGEX.test(pin)) return { ok: false, error: "Initial PIN must be 6 digits" };
  const weak = pinWeakness(pin);
  if (weak) return { ok: false, error: weak };
  if (await pinTaken(pin)) return { ok: false, error: "That PIN is already used by another user — pick a different one" };
  const id = createUserWithWorkspace(name, hashPin(pin), false);
  revalidatePath("/settings");
  return { ok: true, id };
}

export async function renameUser(id: string, name: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const target = parseId(id);
  if (!ctx.isAdmin && ctx.userId !== target) return { ok: false, error: "You can only rename yourself" };
  let clean: string;
  try { clean = parseName(name, "Name", 40); } catch (e) { return { ok: false, error: (e as Error).message }; }
  await db.execute("UPDATE USER SET NAME = ? WHERE ID = ? AND DELETED_AT IS NULL", [clean, target]);
  revalidatePath("/settings");
  revalidatePath("/login");
  return { ok: true };
}

export async function resetUserPin(id: string, pin: string): Promise<ActionResult> {
  await requireAdmin();
  const target = parseId(id);
  if (!PIN_REGEX.test(pin)) return { ok: false, error: "PIN must be 6 digits" };
  const weak = pinWeakness(pin);
  if (weak) return { ok: false, error: weak };
  if (await pinTaken(pin, target)) return { ok: false, error: "That PIN is already used by another user — pick a different one" };
  await db.execute("UPDATE USER SET PIN_HASH = ?, SESSION_VERSION = SESSION_VERSION + 1 WHERE ID = ? AND DELETED_AT IS NULL", [hashPin(pin), target]);
  revalidatePath("/settings");
  return { ok: true };
}

// ---------- email second factor (self-service) ----------

export async function setEmail(email: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const clean = String(email ?? "").trim().toLowerCase();
  if (clean && (!EMAIL_RE.test(clean) || clean.length > 120)) return { ok: false, error: "That doesn't look like an email address" };
  // A changed (or removed) address is unverified until a code proves it, and
  // the check is switched off so a typo can't lock the user out.
  await db.execute("UPDATE USER SET EMAIL = ?, EMAIL_VERIFIED_AT = NULL, REQUIRE_2FA = 0 WHERE ID = ?", [clean || null, ctx.userId]);
  revalidatePath("/settings");
  return { ok: true };
}

export async function sendEmailVerification(): Promise<ActionResult> {
  const ctx = await requireAuth();
  const [rows] = await db.execute("SELECT EMAIL FROM USER WHERE ID = ?", [ctx.userId]);
  const email = (rows as Array<{ EMAIL: string | null }>)[0]?.EMAIL;
  if (!email) return { ok: false, error: "Save an email address first" };
  if (!mailConfigured() && process.env.NODE_ENV === "production") return { ok: false, error: "Email sending isn't configured on this server" };
  const challenge = await createChallenge(ctx.userId);
  if (!challenge) return { ok: false, error: "Too many codes requested — wait ten minutes" };
  const sent = await sendMail(email, "Verify your email for Empty Wallet", `Your verification code is ${challenge.code}\n\nIt expires in 10 minutes.`);
  if (!sent) return { ok: false, error: "Couldn't send the email — check the SMTP settings" };
  revalidatePath("/settings");
  return { ok: true };
}

export async function verifyEmail(code: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  const id = await latestChallengeId(ctx.userId);
  if (!id) return { ok: false, error: "No code outstanding — send one first" };
  const result = await verifyChallenge(id, ctx.userId, String(code ?? "").trim());
  if (result !== "ok") return { ok: false, error: result === "wrong" ? "Wrong code" : "That code can't be used any more — send a new one" };
  await db.execute("UPDATE USER SET EMAIL_VERIFIED_AT = CURRENT_TIMESTAMP, REQUIRE_2FA = 1 WHERE ID = ?", [ctx.userId]);
  revalidatePath("/settings");
  return { ok: true };
}

export async function setRequire2fa(on: boolean): Promise<ActionResult> {
  const ctx = await requireAuth();
  if (on) {
    const [rows] = await db.execute("SELECT EMAIL_VERIFIED_AT FROM USER WHERE ID = ?", [ctx.userId]);
    if (!(rows as Array<{ EMAIL_VERIFIED_AT: string | null }>)[0]?.EMAIL_VERIFIED_AT) return { ok: false, error: "Verify your email first" };
  }
  await db.execute("UPDATE USER SET REQUIRE_2FA = ? WHERE ID = ?", [on ? 1 : 0, ctx.userId]);
  revalidatePath("/settings");
  return { ok: true };
}

export async function forgetDeviceAction(id: string): Promise<ActionResult> {
  const ctx = await requireAuth();
  await forgetDevice(ctx.userId, parseId(id));
  revalidatePath("/settings");
  return { ok: true };
}

export async function forgetAllDevicesAction(): Promise<ActionResult> {
  const ctx = await requireAuth();
  await forgetAllDevices(ctx.userId);
  revalidatePath("/settings");
  return { ok: true };
}

/** Admin recovery: switch off the email check for a user who lost mailbox access. */
export async function adminDisable2fa(id: string): Promise<ActionResult> {
  await requireAdmin();
  await db.execute("UPDATE USER SET REQUIRE_2FA = 0 WHERE ID = ? AND DELETED_AT IS NULL", [parseId(id)]);
  revalidatePath("/settings");
  return { ok: true };
}

export async function unlockClient(key: string): Promise<ActionResult> {
  await requireAdmin();
  unlock(String(key).slice(0, 100));
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeUser(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  const target = parseId(id);
  if (target === ctx.userId) return { ok: false, error: "You can't remove yourself" };
  await db.execute("UPDATE USER SET DELETED_AT = CURRENT_TIMESTAMP, SESSION_VERSION = SESSION_VERSION + 1 WHERE ID = ? AND DELETED_AT IS NULL", [target]);
  revalidatePath("/settings");
  revalidatePath("/login");
  return { ok: true };
}
