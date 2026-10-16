"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { PIN_REGEX, createUserWithWorkspace, hashPin, pinTaken, requireAuth } from "@/lib/auth";
import { parseId, parseName } from "@/lib/validate";
import type { ActionResult } from "@/app/actions";
import { unlock } from "@/lib/ratelimit";
import { pinWeakness } from "@/lib/pin-policy";

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
