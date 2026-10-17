"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEVICE_COOKIE,
  PENDING_COOKIE,
  PIN_REGEX,
  clearSessionCookie,
  createUserWithWorkspace,
  findUserByPin,
  getUser,
  hasAnyUser,
  hashPin,
  isLegacyPinHash,
  isTrustedDevice,
  issueSessionCookie,
  pinTaken,
  requireAuth,
  setUserPin,
  verifyPin,
} from "@/lib/auth";
import { createPendingToken, getSessionSecret, parsePendingToken, sessionCookieOptions } from "@/lib/session";
import { createChallenge, describeDevice, issueDevice, maskEmail, verifyChallenge, DEVICE_TTL_MS } from "@/lib/twofa";
import { sendMail } from "@/lib/mailer";
import { clearFailures, globalLockoutRemainingMs, lockoutRemainingMs, recordFailure } from "@/lib/ratelimit";
import { pinWeakness } from "@/lib/pin-policy";
import { parseName } from "@/lib/validate";
import { landingPath } from "@/lib/preferences";
import { getPreferences } from "@/lib/preferences-db";

// Lockout is keyed by client IP (first hop of X-Forwarded-For behind the
// ingress). The PIN alone identifies the user, so there is no user to key on
// before it is verified.
async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

const seconds = (ms: number) => Math.ceil(ms / 1000);
const siteMessage = (ms: number) => `Sign-in is paused for ${seconds(ms)}s after too many failed attempts site-wide`;
const lockedMessage = (ms: number) =>
  ms >= 3_600_000
    ? `Locked for ${Math.ceil(ms / 3_600_000)} hours after repeated attempts — an admin can unlock from Settings`
    : `Too many attempts. Try again in ${seconds(ms)}s`;

async function checkPin(pin: string, expected: string): Promise<{ error: string } | null> {
  const key = await clientKey();
  const site = globalLockoutRemainingMs();
  if (site > 0) return { error: siteMessage(site) };
  const locked = lockoutRemainingMs(key);
  if (locked > 0) return { error: lockedMessage(locked) };
  if (!verifyPin(pin, expected)) {
    const lock = recordFailure(key);
    return { error: lock > 0 ? lockedMessage(lock) : "Wrong PIN" };
  }
  clearFailures(key);
  return null;
}

// The user's chosen start page (Settings → Preferences); never throws, so a
// bad preference row can't block sign-in.
async function landingFor(userId: string): Promise<string> {
  try {
    return landingPath(await getPreferences(userId));
  } catch {
    return "/dashboard";
  }
}

export async function login(formData: FormData) {
  const pin = formData.get("pin") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };

  const key = await clientKey();
  const site = globalLockoutRemainingMs();
  if (site > 0) return { error: siteMessage(site) };
  const locked = lockoutRemainingMs(key);
  if (locked > 0) return { error: lockedMessage(locked) };

  // The PIN picks the user. No user matches → one failed attempt against the IP.
  const user = await findUserByPin(pin);
  if (!user) {
    const lock = recordFailure(key);
    return { error: lock > 0 ? lockedMessage(lock) : "Wrong PIN" };
  }
  clearFailures(key);

  // Upgrade path: a legacy unsalted hash is replaced with salted scrypt on
  // the first successful login (without bumping the session version).
  if (isLegacyPinHash(user.PIN_HASH)) {
    const { default: db } = await import("@/lib/db");
    await db.execute("UPDATE USER SET PIN_HASH = ? WHERE ID = ?", [hashPin(pin), user.ID]);
  }

  // Second factor: a code by email on browsers this user hasn't remembered.
  if (user.REQUIRE_2FA && user.EMAIL && user.EMAIL_VERIFIED_AT && !(await isTrustedDevice(user.ID))) {
    const sent = await startEmailChallenge(user.ID, user.EMAIL);
    if ("error" in sent) return sent;
    redirect("/login");
  }

  await issueSessionCookie(user);
  redirect(await landingFor(user.ID));
}

async function startEmailChallenge(userId: string, email: string): Promise<{ error: string } | { ok: true }> {
  const challenge = await createChallenge(userId);
  if (!challenge) return { error: "Too many codes requested — wait ten minutes and try again" };
  const sent = await sendMail(email, "Your Empty Wallet sign-in code", `Your sign-in code is ${challenge.code}\n\nIt expires in 10 minutes. If this wasn't you, change your PIN.`);
  if (!sent) return { error: "Couldn't send the code — email isn't set up. Ask an admin to turn off the email check for you." };
  const cookieStore = await cookies();
  cookieStore.set(PENDING_COOKIE, createPendingToken(getSessionSecret(), { userId, challengeId: challenge.id }), { ...sessionCookieOptions(process.env.NODE_ENV === "production"), maxAge: 600 });
  return { ok: true };
}

/** What the login page needs to render the code step, or null when no code is outstanding. */
export async function pendingChallenge(): Promise<{ email: string } | null> {
  const cookieStore = await cookies();
  const claims = parsePendingToken(getSessionSecret(), cookieStore.get(PENDING_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUser(claims.userId);
  if (!user?.EMAIL) return null;
  return { email: maskEmail(user.EMAIL) };
}

export type CodeStepResult = { error: string; restart?: boolean };

export async function verifyCode(formData: FormData): Promise<CodeStepResult> {
  const cookieStore = await cookies();
  const claims = parsePendingToken(getSessionSecret(), cookieStore.get(PENDING_COOKIE)?.value);
  if (!claims) return { error: "This code request has expired — enter your PIN again", restart: true };
  const code = String(formData.get("code") ?? "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code" };
  const user = await getUser(claims.userId);
  if (!user) return { error: "No such user", restart: true };

  const result = await verifyChallenge(claims.challengeId, user.ID, code);
  if (result === "wrong") return { error: "Wrong code" };
  if (result !== "ok") {
    cookieStore.delete(PENDING_COOKIE);
    return { error: result === "locked" ? "Too many wrong codes — enter your PIN again for a new one" : "That code has expired — enter your PIN again", restart: true };
  }

  cookieStore.delete(PENDING_COOKIE);
  if (formData.get("remember") === "1") {
    const h = await headers();
    const token = await issueDevice(user.ID, describeDevice(h.get("user-agent")));
    cookieStore.set(DEVICE_COOKIE, token, { ...sessionCookieOptions(process.env.NODE_ENV === "production"), maxAge: DEVICE_TTL_MS / 1000 });
  }
  await issueSessionCookie(user);
  redirect(await landingFor(user.ID));
}

export async function resendCode(): Promise<CodeStepResult | { ok: true }> {
  const cookieStore = await cookies();
  const claims = parsePendingToken(getSessionSecret(), cookieStore.get(PENDING_COOKIE)?.value);
  if (!claims) return { error: "Enter your PIN again", restart: true };
  const user = await getUser(claims.userId);
  if (!user?.EMAIL) return { error: "Enter your PIN again", restart: true };
  const res = await startEmailChallenge(user.ID, user.EMAIL);
  return "error" in res ? res : { ok: true };
}

export async function cancelPending() {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_COOKIE);
  redirect("/login");
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
  const weak = pinWeakness(pin);
  if (weak) return { error: weak };
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
  const weak = pinWeakness(next);
  if (weak) return { error: weak };
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

// Note: /logout (route handler) does the same for a stale cookie that a page
// rejected; see currentContext() in lib/auth.ts.
