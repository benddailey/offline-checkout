import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PHOTO_BASE, PHOTOS } from "../src/ui/backgrounds/photos";
import { appUrl } from "./helpers/app";

test("built file opens from file:// and reaches out only for the photo backgrounds", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) external.push(r.url());
  });
  await page.goto(appUrl());
  await expect(page.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
  // The e2e browsers can't resolve Pages, so each photo is attempted once and fails.
  await expect.poll(() => external.length).toBe(PHOTOS.length);
  expect(external.sort()).toEqual(PHOTOS.map((p) => `${PHOTO_BASE}${p.id}.webp`).sort());
  // The requests are plain downloads: nothing about the session goes with them.
  expect(external.every((url) => !url.includes("?"))).toBe(true);
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
    "## Background photos",
    "Carol M. Highsmith",
    "Photo: Diliff",
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

test("carries its icons inline and shows the logo", async ({ page }) => {
  await page.goto(appUrl());
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    /^data:image\/svg\+xml;base64,/,
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /^data:image\/png;base64,/,
  );
  const logo = page.getByTestId("app-logo");
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
