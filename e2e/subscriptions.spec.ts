import { expect, test } from "@playwright/test";
import { login, tag, toast } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/subscriptions");
});

test("Paid on the first upcoming bill records it", async ({ page }) => {
  await page.getByRole("button", { name: "Paid" }).first().click();
  await expect(toast(page)).toContainText(/ recorded in /);
});

test("adding a subscription shows it in the list", async ({ page }, info) => {
  const name = `E2E Stream ${tag(info)}`;
  await page.getByRole("button", { name: "Add subscription" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "New subscription" }) });
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="amount"]').fill("7.99");
  await form.locator('input[name="day"]').fill("12");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page)).toContainText("Subscription added");
  const active = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Active", exact: true }) });
  await expect(active.getByText(name, { exact: true })).toBeVisible();
});
