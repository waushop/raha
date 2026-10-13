"use server";

import { redirect } from "next/navigation";
import {
  PIN_REGEX,
  clearSessionCookie,
  constantTimeEqual,
  getPinHash,
  hashPin,
  issueSessionCookie,
  persistEnvHashIfNeeded,
  requireAuth,
  setPinHash,
} from "@/lib/auth";
import { rotateSessionSecret } from "@/lib/session";

export async function login(formData: FormData) {
  const pin = formData.get("pin") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };

  const expected = await getPinHash();
  if (!expected) return { error: "No PIN set" };

  const candidate = hashPin(pin);
  if (!constantTimeEqual(candidate, expected)) return { error: "Wrong PIN" };

  await persistEnvHashIfNeeded(candidate);
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
  if (!constantTimeEqual(hashPin(current), expected)) return { error: "Current PIN is wrong" };
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
