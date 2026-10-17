import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("cash flow shows Safe to spend from the seeded balance and payday", async ({ page }) => {
  await login(page);
  await page.goto("/cashflow");
  const tile = page.locator(".card").filter({ has: page.getByText("Safe to spend", { exact: true }) });
  await expect(tile).toContainText(/-?\d[\d,]*\.\d{2} €/);
  await expect(tile).toContainText(/until /);
});
