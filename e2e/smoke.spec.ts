import { expect, test } from "@playwright/test";
import { appUrl } from "./helpers/app";

test("built file opens from file:// with no network requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("file:") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.goto(appUrl());
  await expect(page.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
  expect(external).toEqual([]);
});
