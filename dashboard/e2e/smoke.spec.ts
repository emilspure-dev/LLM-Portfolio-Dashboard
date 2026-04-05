import { test, expect } from "@playwright/test";

test("home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
