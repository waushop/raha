"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PIN_REGEX,
  clearSessionCookie,
  createUserWithWorkspace,
  findUserByPin,
  getUser,
  hasAnyUser,
  hashPin,
  isLegacyPinHash,
  issueSessionCookie,
  pinTaken,
  requireAuth,
  setUserPin,
  verifyPin,
} from "@/lib/auth";
import { clearFailures, lockoutRemainingMs, recordFailure } from "@/lib/ratelimit";
import { parseName } from "@/lib/validate";

// Lockout is keyed by client IP (first hop of X-Forwarded-For behind the
// ingress). The PIN alone identifies the user, so there is no user to key on
// before it is verified.
async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

const seconds = (ms: number) => Math.ceil(ms / 1000);

async function checkPin(pin: string, expected: string): Promise<{ error: string } | null> {
  const key = await clientKey();
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
  const pin = formData.get("pin") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };

  const key = await clientKey();
  const locked = lockoutRemainingMs(key);
  if (locked > 0) return { error: `Too many attempts. Try again in ${seconds(locked)}s` };

  // The PIN picks the user. No user matches → one failed attempt against the IP.
  const user = await findUserByPin(pin);
  if (!user) {
    const lock = recordFailure(key);
    return { error: lock > 0 ? `Wrong PIN. Locked for ${seconds(lock)}s` : "Wrong PIN" };
  }
  clearFailures(key);

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
  if (await pinTaken(pin)) return { error: "That PIN is already in use" };

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
  const failure = await checkPin(current, user.PIN_HASH);
  if (failure) return { error: failure.error.replace("Wrong PIN", "Current PIN is wrong") };
  if (!next || !PIN_REGEX.test(next)) return { error: "New PIN must be 6 digits" };
  if (next !== confirm) return { error: "New PINs don't match" };
  if (next === current) return { error: "New PIN must differ from current" };
  // PINs identify users at login, so two people can't share one.
  if (await pinTaken(next, user.ID)) return { error: "That PIN is already used by someone else — pick another" };

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
