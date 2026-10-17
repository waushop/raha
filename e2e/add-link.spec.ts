import { expect, test } from "@playwright/test";
import { login, monthFromNow, tag } from "./helpers";

test("/add deep link creates the row and highlights it on the month view", async ({ page }, info) => {
  const name = `E2E ${tag(info)}`;
  await login(page);
  await page.goto(`/add?name=${encodeURIComponent(name)}&amount=4.2`);

  await expect(page).toHaveURL(new RegExp(`/\\?month=${monthFromNow()}#e-[0-9a-f-]+$`));
  const id = new URL(page.url()).hash.slice(1);
  const created = page.locator(`#${id}`);
  await expect(created).toContainText(name);
  await expect(created).toContainText("4.20 €");
  await expect(created).toHaveClass(/row-highlight/);
});
