import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isPhone, login, tag, toast } from "./helpers";

/** The sidebar's ledger switcher; phones open the drawer from the bottom bar first. */
async function openSwitcher(page: Page, info: TestInfo) {
  if (isPhone(info)) await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Menu" }).click();
  const button = page.locator("aside").locator('button[aria-haspopup="listbox"]');
  await button.click();
  return { button, list: page.getByRole("listbox") };
}

test("create a household, see Settle up and switch back to the personal ledger", async ({ page }, info) => {
  const household = `Home ${tag(info)}`;
  await login(page);
  await page.goto("/settings");

  await page.getByRole("button", { name: "Create a household" }).click();
  const form = page.locator("form").filter({ hasText: "Household name" });
  await form.locator('input[name="name"]').fill(household);
  await expect(form.getByRole("checkbox", { name: "Mari" })).toBeChecked();
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(toast(page)).toContainText("Household created");
  await page.waitForURL(/\/dashboard$/);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Settle up · / })).toBeVisible();

  const { button, list } = await openSwitcher(page, info);
  await expect(button).toContainText(household);
  await expect(list.getByRole("option", { name: household })).toBeVisible();
  await expect(list.getByRole("option", { name: "Demo's ledger" })).toBeVisible();

  await list.getByRole("option", { name: "Demo's ledger" }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Settle up · / })).toHaveCount(0);
  const again = await openSwitcher(page, info);
  await expect(again.button).toContainText("Demo's ledger");
});
