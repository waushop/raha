"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "crypto";

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function login(formData: FormData) {
  const pin = formData.get("pin") as string;
  if (!pin || pin.length !== 6) return { error: "Sisesta 6-kohaline PIN" };

  const hash = hashPin(pin);
  const expected = process.env.AUTH_PIN_HASH;

  if (hash !== expected) return { error: "Vale PIN" };

  const token = generateToken();
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const cookieStore = await cookies();
  cookieStore.set("auth", tokenHash, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  redirect("/");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete("auth");
  redirect("/login");
}
