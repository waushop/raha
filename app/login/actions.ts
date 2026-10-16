"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PIN_REGEX,
  clearSessionCookie,
  createUserWithWorkspace,
  getUser,
  hasAnyUser,
  hashPin,
  isLegacyPinHash,
  issueSessionCookie,
  requireAuth,
  setUserPin,
  verifyPin,
} from "@/lib/auth";
import { clearFailures, lockoutRemainingMs, recordFailure } from "@/lib/ratelimit";
import { parseName } from "@/lib/validate";

// Lockout is keyed by client IP + user (first hop of X-Forwarded-For behind
// the ingress), so guessing one person's PIN doesn't lock the other out.
async function clientKey(userId: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  return `${ip}:${userId}`;
}

const seconds = (ms: number) => Math.ceil(ms / 1000);

async function checkPin(userId: string, pin: string, expected: string): Promise<{ error: string } | null> {
  const key = await clientKey(userId);
  const locked = lockoutRemainingMs(key);
  if (locked > 0) return { error: `Too many attempts. Try again in ${seconds(locked)}s` };
  if (!verifyPin(pin, expected)) {
    const lock = recordFailure(key);
    return { error: lock > 0 ? `Wrong PIN. Locked for ${seconds(lock)}s` : "Wrong PIN" };
  }
  clearFailures(key);
  return null;
}

export async function login(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const pin = formData.get("pin") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };

  const user = await getUser(userId);
  if (!user) return { error: "Pick who you are" };

  const failure = await checkPin(user.ID, pin, user.PIN_HASH);
  if (failure) return failure;

  // Upgrade path: a legacy unsalted hash is replaced with salted scrypt on
  // the first successful login (without bumping the session version).
  if (isLegacyPinHash(user.PIN_HASH)) {
    const { default: db } = await import("@/lib/db");
    await db.execute("UPDATE USER SET PIN_HASH = ? WHERE ID = ?", [hashPin(pin), user.ID]);
  }

  await issueSessionCookie(user);
  redirect("/dashboard");
}

export async function setupInitialUser(formData: FormData) {
  // Only valid on a fresh install: once a user exists, new ones come from
  // Settings (admin only). The page gates the UI, but the action is public.
  if (await hasAnyUser()) return { error: "Already set up — sign in instead" };

  let name: string;
  try { name = parseName(formData.get("name"), "Name", 40); } catch (e) { return { error: (e as Error).message }; }
  const pin = formData.get("pin") as string;
  const confirm = formData.get("confirm") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };
  if (pin !== confirm) return { error: "PINs don't match" };

  const userId = createUserWithWorkspace(name, hashPin(pin), true);
  const user = await getUser(userId);
  if (!user) return { error: "Could not create user" };
  await issueSessionCookie(user);
  redirect("/dashboard");
}

export async function changePin(formData: FormData) {
  const ctx = await requireAuth();
  const user = await getUser(ctx.userId);
  if (!user) return { error: "No such user" };

  const current = formData.get("current") as string;
  const next = formData.get("next") as string;
  const confirm = formData.get("confirm") as string;

  if (!current || !PIN_REGEX.test(current)) return { error: "Enter current 6-digit PIN" };
  const failure = await checkPin(user.ID, current, user.PIN_HASH);
  if (failure) return { error: failure.error.replace("Wrong PIN", "Current PIN is wrong") };
  if (!next || !PIN_REGEX.test(next)) return { error: "New PIN must be 6 digits" };
  if (next !== confirm) return { error: "New PINs don't match" };
  if (next === current) return { error: "New PIN must differ from current" };

  // Changing the PIN logs out this user's other devices (session version
  // bump) and re-issues a token for this browser only. Other users are
  // untouched.
  await setUserPin(user.ID, hashPin(next));
  const refreshed = await getUser(user.ID);
  if (refreshed) await issueSessionCookie(refreshed);
  return { ok: true };
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
