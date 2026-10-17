import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { DEMO_PIN } from "./env";

/** Types a PIN into the six boxes of the login PinGrid. */
export async function enterPin(page: Page, pin: string): Promise<void> {
  const boxes = page.locator('input[inputmode="numeric"]');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(pin[i]);
}

/** Signs in as the seeded "Demo" user (2FA is off) and waits for the landing page. */
export async function login(page: Page, pin: string = DEMO_PIN): Promise<void> {
  await page.goto("/login");
  await enterPin(page, pin);
  await page.waitForURL((url) => url.pathname !== "/login");
}

/** Short suffix that keeps rows created by the phone and desktop runs apart (they share one database). */
export const tag = (info: TestInfo): string => info.project.name;

export const isPhone = (info: TestInfo): boolean => info.project.name === "phone";

/** A ledger row on the month view, by its name. */
export function row(page: Page, name: string): Locator {
  return page.locator('[id^="e-"]').filter({ hasText: name });
}

/** The toast region (role=status). */
export function toast(page: Page): Locator {
  return page.getByRole("status");
}

/** One-line quick add on the month view; waits for the "added" toast and the row. */
export async function quickAdd(page: Page, text: string, name: string): Promise<void> {
  const input = page.getByLabel("Quick add: name, amount and optional #tags");
  await input.fill(text);
  await input.press("Enter");
  await expect(toast(page)).toContainText(`"${name}" added`);
  await expect(row(page, name)).toBeVisible();
  await expect(input).toHaveValue("");
}

/** The add/edit expense dialog's form. */
export function expenseForm(page: Page): Locator {
  return page.locator('form:has(input[name="amount"][step="0.01"]):has(input[name="month"])');
}

/** Today's month as YYYY-MM, offset by `delta` months. */
export function monthFromNow(delta = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
