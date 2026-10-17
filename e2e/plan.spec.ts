import { expect, test } from "@playwright/test";
import { isPhone, login, monthFromNow, toast } from "./helpers";

test("build a plan from averages and edit a planned amount", async ({ page }, info) => {
  // An empty future month per project (the seed only plans the current one).
  const month = monthFromNow(isPhone(info) ? 1 : 2);
  await login(page);
  await page.goto(`/plan?month=${month}`);
  await expect(page.getByText("No plan for this month yet")).toBeVisible();

  await page.getByRole("button", { name: "Build from averages" }).click();
  await expect(toast(page)).toContainText(/\d+ lines? added/);

  const left = page.locator(".card").filter({ has: page.getByText("Left to plan", { exact: true }) });
  await expect(left).toContainText(/[+−-]?\d[\d,]*\.\d{2} €/);
  await expect(left).not.toContainText("no plan yet");

  const input = page.getByLabel(/^Planned for /).first();
  const label = (await input.getAttribute("aria-label"))!;
  await input.fill("123.45");
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/plan");
  await input.press("Enter");
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(page.getByLabel(label, { exact: true })).toHaveValue("123.45");
});
