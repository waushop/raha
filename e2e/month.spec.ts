import { expect, test } from "@playwright/test";
import { expenseForm, isPhone, login, quickAdd, row, tag, toast } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto("/");
});

test("quick add puts a row in the month list with its amount", async ({ page }, info) => {
  const name = `Test coffee ${tag(info)}`;
  await quickAdd(page, `${name} 3.5 #work`, name);
  await expect(row(page, name)).toContainText("3.50 €");
});

test("add, edit, delete and undo an expense", async ({ page }, info) => {
  const name = `Form lunch ${tag(info)}`;

  // Phones use the bottom bar's Add; the desktop bar is hidden, so use the list's button.
  if (isPhone(info)) await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Add expense" }).click();
  else await page.getByRole("button", { name: /^Add expense/ }).click();

  const form = expenseForm(page);
  await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible();
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="amount"]').fill("12.40");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page)).toContainText(`"${name}" added`);
  await expect(row(page, name)).toContainText("12.40 €");

  // Edit the amount through the edit dialog.
  await row(page, name).getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit expense" })).toBeVisible();
  await form.locator('input[name="amount"]').fill("15.75");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page)).toContainText("Saved");
  await expect(row(page, name)).toContainText("15.75 €");

  // Delete, then undo from the toast.
  await row(page, name).getByRole("button", { name: "Delete" }).click();
  await expect(toast(page)).toContainText(`"${name}" deleted`);
  await expect(row(page, name)).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, name)).toBeVisible();

  // The undo reached the server: the row survives a reload.
  await expect(async () => {
    await page.reload();
    await expect(row(page, name)).toContainText("15.75 €", { timeout: 2_000 });
  }).toPass();
});

test("split an expense into two parts", async ({ page }, info) => {
  const name = `Split dinner ${tag(info)}`;
  const part = `Split drinks ${tag(info)}`;
  await quickAdd(page, `${name} 40`, name);

  await row(page, name).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Split…" }).click();
  await page.getByLabel("Part 1 amount").fill("25");
  await page.getByLabel("Part 2 name").fill(part);
  await page.getByLabel("Part 2 amount").fill("15");
  await expect(page.getByText("Adds up")).toBeVisible();
  await page.getByRole("button", { name: "Split into 2" }).click();
  await expect(toast(page)).toContainText("Split into 2 parts");

  for (const [n, amount] of [[name, "25.00 €"], [part, "15.00 €"]] as const) {
    await expect(row(page, n)).toContainText(amount);
    await expect(row(page, n).locator('[title="Part of a split"]')).toBeVisible();
  }
});

test("bulk select two rows and set their category", async ({ page }, info) => {
  const a = `Bulk alpha ${tag(info)}`;
  const b = `Bulk beta ${tag(info)}`;
  await quickAdd(page, `${a} 1.10`, a);
  await quickAdd(page, `${b} 2.20`, b);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  // The checkbox is visually hidden; its 44px label is the tap target.
  for (const n of [a, b]) {
    await row(page, n).locator("label").click();
    await expect(page.getByRole("checkbox", { name: `Select ${n}` })).toBeChecked();
  }
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText("2 selected");
  await bar.getByLabel("Set category").selectOption("dining");
  await expect(toast(page)).toContainText("2 rows updated");

  for (const n of [a, b]) await expect(row(page, n).locator('svg[aria-label="Dining"]')).toBeVisible();
});
