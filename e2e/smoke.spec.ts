import { readFileSync } from "node:fs";
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

test("built file carries the license notices and stays in standards mode", async ({ page }) => {
  const html = readFileSync("dist/offline-checkout.html", "utf8");
  const comment = /^<!doctype html>\n<!--\n([\s\S]*?)\n-->/.exec(html)?.[1] ?? "";
  for (const text of [
    "GNU Affero General Public License",
    "https://github.com/benddailey/offline-checkout",
    "## @vue/runtime-core - ",
    "## jsbarcode - ",
    "Johan Lindell",
    "## zxing-cpp",
    "Apache License",
  ]) {
    expect(comment).toContain(text);
  }
  await page.goto(appUrl());
  expect(await page.evaluate(() => document.compatMode)).toBe("CSS1Compat");
});

test("shows the package.json version", async ({ page }) => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  await page.goto(appUrl());
  await expect(page.getByTestId("app-version")).toHaveText(`Version ${version}`);
  await expect(page.locator('meta[name="offline-checkout-version"]')).toHaveAttribute(
    "content",
    version,
  );
});
