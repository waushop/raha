import { expect, test } from "@playwright/test";
import { login, toast } from "./helpers";

// Runs with ENABLE_BANKING_MOCK=1 (playwright.config.ts): two fake banks whose
// statements are a pure function of the date. The phone run connects the
// bank; the desktop run connects it again, which reconnects the same
// connection and finds nothing new.
const BANK = "Põhja Pank (mock)";

test("connect the mock bank, rows arrive marked From bank, a second sync adds nothing", async ({ page }) => {
  await login(page);
  await page.goto("/bank");
  await expect(page.getByRole("heading", { name: "Bank sync" })).toBeVisible();
  await expect(page.getByText("Mock mode")).toBeVisible();

  await page.getByRole("button", { name: BANK }).click();
  await expect(toast(page)).toContainText("Bank connected");
  await page.waitForURL((url) => url.pathname === "/bank" && !url.search);

  const connection = page.getByRole("region", { name: BANK });
  await expect(connection).toContainText("active");
  await expect(connection).toContainText("EE38 •••• 5685");
  await expect(connection).toContainText(/Last sync (just now|\d+ min ago)/);

  await page.goto("/");
  const fromBank = page.locator('[id^="e-"]').filter({ has: page.locator('[title="From bank"]') });
  await expect(fromBank.first()).toBeAttached();
  await expect(fromBank.filter({ hasText: "Bolt" }).first()).toBeAttached();

  await page.goto("/bank");
  await page.getByRole("region", { name: BANK }).getByRole("button", { name: "Sync now" }).click();
  await expect(toast(page)).toContainText("Up to date · nothing new");
});
