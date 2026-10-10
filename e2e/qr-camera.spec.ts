import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, test, expect, type Page } from "@playwright/test";
import { launchChromium } from "./helpers/app";
import { writeQrY4m } from "./helpers/y4m";

const harnessUrl = pathToFileURL(resolve(process.cwd(), "dist-harness", "qr-harness.html")).href;

function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (req) => {
    if (!/^(file|data|blob):/.test(req.url())) external.push(req.url());
  });
  return external;
}

test("camera decodes a QR code with no network requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qr-"));
  const y4m = join(dir, "qr.y4m");
  writeQrY4m("OC1:hello-qr", y4m);
  const browser = await launchChromium([`--use-file-for-fake-video-capture=${y4m}`]);
  try {
    const page = await (await browser.newContext()).newPage();
    const external = trackExternalRequests(page);
    await page.goto(harnessUrl);
    await expect(page.locator("#out")).toHaveText("OC1:hello-qr", { timeout: 15_000 });
    expect(external).toEqual([]);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pasted code is emitted trimmed without a camera", async () => {
  const browser = await launchChromium();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(harnessUrl);
    await page.getByLabel("Pasted code").fill("  OC1:pasted  \n");
    await page.getByRole("button", { name: "Use pasted code" }).click();
    await expect(page.locator("#out")).toHaveText("OC1:pasted");
  } finally {
    await browser.close();
  }
});

test("shows the camera-unavailable message when permission is denied, paste still works", async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--deny-permission-prompts", "--use-fake-device-for-media-stream"],
  });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(harnessUrl);
    await expect(
      page.getByText(
        "Camera unavailable. Click Allow on the camera prompt in the address bar, or paste the code below.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Pasted code").fill("OC1:fallback");
    await page.getByRole("button", { name: "Use pasted code" }).click();
    await expect(page.locator("#out")).toHaveText("OC1:fallback");
  } finally {
    await browser.close();
  }
});
