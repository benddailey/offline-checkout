import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { LATEST_URL, RELEASES_URL } from "../src/update/latest";
import { openApp } from "./helpers/app";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const bump = version.replace(/\d+$/, (n) => String(Number(n) + 1));
const cors = { "access-control-allow-origin": "*" };

test("a newer published version links to the latest release", async ({ page }) => {
  await page.route(LATEST_URL, (route) =>
    route.fulfill({ json: { version: bump }, headers: cors }),
  );
  await openApp(page);
  const link = page.getByTestId("newer-version");
  await expect(link).toHaveText(`Version ${bump} is available`);
  await expect(link).toHaveAttribute("href", RELEASES_URL);
});

test("the same version shows nothing", async ({ page }) => {
  let asked = false;
  await page.route(LATEST_URL, (route) => {
    asked = true;
    return route.fulfill({ json: { version }, headers: cors });
  });
  await openApp(page);
  await expect.poll(() => asked).toBe(true);
  await expect(page.getByTestId("newer-version")).toHaveCount(0);
});

test("offline, the launch screen works and shows nothing", async ({ page }) => {
  await page.route(LATEST_URL, (route) => route.abort("internetdisconnected"));
  await openApp(page);
  await expect(page.getByTestId("app-version")).toHaveText(`Version ${version}`);
  await expect(page.getByTestId("newer-version")).toHaveCount(0);
});
