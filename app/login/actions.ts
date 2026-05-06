"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  PIN_REGEX,
  constantTimeEqual,
  generateAuthToken,
  getPinHash,
  hashPin,
  persistEnvHashIfNeeded,
  setPinHash,
} from "@/lib/auth";

async function setAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.set("auth", generateAuthToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export async function login(formData: FormData) {
  const pin = formData.get("pin") as string;
  if (!pin || !PIN_REGEX.test(pin)) return { error: "Enter 6-digit PIN" };

  const expected = await getPinHash();
  if (!expected) return { error: "No PIN set" };

  const candidate = hashPin(pin);
  if (!constantTimeEqual(candidate, expected)) return { error: "Wrong PIN" };

  await persistEnvHashIfNeeded(candidate);
  await setAuthCookie();
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
  await setAuthCookie();
  redirect("/dashboard");
}

export async function changePin(formData: FormData) {
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
  return { ok: true };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete("auth");
  redirect("/login");
}

