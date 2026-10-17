import { expect, test } from "@playwright/test";
import { enterPin, login } from "./helpers";

test("signing in with the PIN lands on the dashboard", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Safe to spend" })).toBeVisible();
});

test("a wrong PIN shows an error and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await enterPin(page, "908172");
  await expect(page.getByText("Wrong PIN")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
