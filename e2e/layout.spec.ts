import { expect, test } from "@playwright/test";
import { isPhone, login } from "./helpers";

const PAGES = ["/", "/dashboard", "/plan", "/subscriptions", "/cashflow", "/analytics", "/settings"];

test("no horizontal scroll on the main pages at phone width", async ({ page }, info) => {
  test.skip(!isPhone(info), "phone layout only");
  await login(page);
  for (const path of PAGES) {
    await test.step(path, async () => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement!.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect.soft(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(innerWidth + 1);
    });
  }
});
