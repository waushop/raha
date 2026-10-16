"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PIN_REGEX,
  clearSessionCookie,
  getPinHash,
  hashPin,
  isLegacyPinHash,
  isPinSetInDb,
  issueSessionCookie,
  requireAuth,
  setPinHash,
  verifyPin,
} from "@/lib/auth";
import { rotateSessionSecret } from "@/lib/session";
import { clearFailures, lockoutRemainingMs, recordFailure } from "@/lib/ratelimit";

// Lockout is keyed by client IP (first hop of X-Forwarded-For behind the
// ingress). A single home deployment rarely sees more than one, so this is
// effectively a global brake on PIN guessing.
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

  const expected = await getPinHash();
  if (!expected) return { error: "No PIN set" };

  const failure = await checkPin(pin, expected);
  if (failure) return failure;

  // Upgrade path: a legacy unsalted hash (DB or AUTH_PIN_HASH bootstrap) is
  // replaced with salted scrypt in the DB on the first successful login.
  if (isLegacyPinHash(expected) || !(await isPinSetInDb())) await setPinHash(hashPin(pin));

  await issueSessionCookie();
  redirect("/dashboard");
}

export async function setupInitialPin(formData: FormData) {
  // Defense in depth: setting an initial PIN is only valid when neither the
  // DB nor the env var has one. The page also gates the UI on this, but a
  // motivated user could replay the form action.
  if (await getPinHash()) return { error: "PIN already set" };

  const pin = formData.get("pin") as string;
  const confirm = formData.get("confirm") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };
  if (pin !== confirm) return { error: "PINs don't match" };

  await setPinHash(hashPin(pin));
  await issueSessionCookie();
  redirect("/dashboard");
}

export async function changePin(formData: FormData) {
  await requireAuth();

  const current = formData.get("current") as string;
  const next = formData.get("next") as string;
  const confirm = formData.get("confirm") as string;

  const expected = await getPinHash();
  if (!expected) return { error: "No PIN set" };
  if (!current || !PIN_REGEX.test(current)) return { error: "Enter current 6-digit PIN" };
  const failure = await checkPin(current, expected);
  if (failure) return { error: failure.error.replace("Wrong PIN", "Current PIN is wrong") };
  if (!next || !PIN_REGEX.test(next)) return { error: "New PIN must be 6 digits" };
  if (next !== confirm) return { error: "New PINs don't match" };
  if (next === current) return { error: "New PIN must differ from current" };

  await setPinHash(hashPin(next));
  // Changing the PIN logs out every other device: rotate the signing secret
  // (invalidating all tokens) and re-issue a token for this browser only.
  rotateSessionSecret();
  await issueSessionCookie();
  return { ok: true };
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
