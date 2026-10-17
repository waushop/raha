import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expenseForm, login, row, tag, toast } from "./helpers";

// The e2e server runs with AI_MOCK=1: the assistant answers from one real
// tool chosen by keywords, and a receipt scan returns a fixed Rimi receipt
// (23.47 €, groceries + personal items), so no API key is needed.

test("asking a suggested question answers with a figure and an in-app link", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByRole("heading", { name: "Ask your money" })).toBeVisible();

  await page.getByRole("button", { name: "How much did we spend on groceries this year?" }).click();
  const answer = page.getByTestId("assistant-answer").last();
  await expect(answer).toContainText(/\d[\d,]*\.\d{2} €/);
  const link = answer.getByRole("link", { name: "See them in search" });
  await expect(link).toHaveAttribute("href", /^\/search\?.*category=groceries/);
  await link.click();
  await expect(page).toHaveURL(/\/search\?.*category=groceries/);
});

test("a follow-up question keeps the conversation going", async ({ page }) => {
  await login(page);
  await page.goto("/assistant");
  const input = page.getByLabel("Ask a question about your money");
  await input.fill("Biggest expenses last month");
  await input.press("Enter");
  await expect(page.getByTestId("assistant-answer")).toHaveCount(1);
  await expect(page.getByTestId("assistant-answer").first()).toContainText(/Biggest expenses|No expenses/);
  await input.fill("What subscriptions went up?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("assistant-answer")).toHaveCount(2);
  await expect(page.getByTestId("assistant-answer").last().getByRole("link", { name: "Open subscriptions" })).toHaveAttribute("href", "/subscriptions");
});

test("scanning a receipt prefills the add form and can split it by category", async ({ page }, info) => {
  await login(page);
  await page.goto("/");
  await page.getByTestId("receipt-input").first().setInputFiles(join(__dirname, "fixtures", "receipt.jpg"));

  const form = expenseForm(page);
  await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible();
  await expect(page.getByTestId("receipt-preview")).toContainText("Scanned · check the amount");
  await expect(page.getByRole("img", { name: "Scanned receipt" })).toBeVisible();
  // Merchant cleaned ("RIMI HAABERSTI 1234" → "Rimi Haabersti"), total and item list from the scan.
  await expect(form.locator('input[name="name"]')).toHaveValue("Rimi Haabersti");
  await expect(form.locator('input[name="amount"]')).toHaveValue("23.47");
  await expect(form.locator('input[name="notes"]')).toHaveValue(/^Milk 1\.29, Bread 2\.18/);

  const name = `Scanned ${tag(info)}`;
  await form.locator('input[name="name"]').fill(name);
  await page.getByLabel("Split by category").check();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page)).toContainText(`"${name}" added`);
  // One row per category: groceries 14.97 + personal 8.50.
  await expect(row(page, name)).toHaveCount(2);
  await expect(row(page, name).filter({ hasText: "14.97 €" })).toHaveCount(1);
  await expect(row(page, name).filter({ hasText: "8.50 €" })).toHaveCount(1);
});

test("the assistant page fits a phone screen", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await login(page);
  await page.goto("/assistant");
  await page.getByRole("button", { name: "Biggest expenses last month" }).click();
  await expect(page.getByTestId("assistant-answer")).toHaveCount(1);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.scrollingElement!.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
});
