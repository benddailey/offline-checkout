import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./helpers/app";
import { stubPrint } from "./helpers/print";

const VIEWPORT = { width: 1366, height: 768 };

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve("test-results", "screens", `${name}.png`) });
}

test("the main screens render at 1366x768 (screenshots for review)", async ({ browser }) => {
  test.setTimeout(90_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: VIEWPORT })));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const page of [a!, b!]) {
      await stubPrint(page);
      await page.goto(appUrl());
    }

    await expect(a!.getByRole("button", { name: "Start session" })).toBeVisible();
    await shot(a!, "1-launch");

    await a!.getByLabel("Session name").fill("Saturday Outage");
    await a!.getByLabel("Clerk name").fill("Ann");
    await a!.getByRole("button", { name: "Start session" }).click();
    await expect(a!.getByLabel("Scanner input")).toBeVisible();
    await shot(a!, "2-scan-empty");

    await a!.getByRole("button", { name: "Not now" }).click();
    await a!.keyboard.type("P1001\n");
    for (const code of ["I2001", "I2002", "I2003", "I2004", "I2005"]) {
      await a!.keyboard.type(`${code}\n`);
    }
    await a!.getByRole("button", { name: "Void I2002" }).click();
    await a!.keyboard.type("I2001\n");
    await expect(a!.getByTestId("message")).toBeVisible();
    await expect(a!.getByTestId("item")).toHaveCount(5);
    await shot(a!, "3-scan");
    expect(await a!.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      VIEWPORT.height,
    );

    // A typical busy visit (8 items) keeps the scanner input and patron buttons on screen.
    for (const code of ["I2006", "I2007", "I2008"]) await a!.keyboard.type(`${code}\n`);
    await expect(a!.getByTestId("item")).toHaveCount(8);
    await shot(a!, "3b-scan-8-items");
    await expect(a!.getByRole("button", { name: "Void I2008" })).toBeInViewport();
    expect(await a!.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      VIEWPORT.height,
    );

    await expect(a!.getByTestId("finish-patron")).toBeVisible();
    await a!.keyboard.type("OC-END\n");
    await expect(a!.getByText("Scan patron card")).toBeVisible();

    await a!.getByRole("button", { name: "Add workstation" }).click();
    const offer = a!.getByLabel("Join code", { exact: true });
    await expect(offer).not.toHaveValue("", { timeout: 15_000 });
    await expect(a!.locator("canvas, svg, img").first()).toBeVisible();
    await shot(a!, "4-pair-invite");

    await b!.getByRole("button", { name: "Join session" }).click();
    await b!.getByLabel("Pasted code").fill(await offer.inputValue());
    await b!.getByRole("button", { name: "Use pasted code" }).click();
    await b!.getByRole("button", { name: "Join", exact: true }).click();
    await b!.getByLabel("Clerk name").fill("Ben");
    await b!.getByRole("button", { name: "Continue" }).click();
    await expect(b!.getByLabel("Reply code", { exact: true })).not.toHaveValue("", {
      timeout: 15_000,
    });
    await shot(b!, "5-pair-answer");

    await a!
      .getByLabel("Pasted code")
      .fill(await b!.getByLabel("Reply code", { exact: true }).inputValue());
    await a!.getByRole("button", { name: "Use pasted code" }).click();
    await expect(a!.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });

    await a!.getByRole("button", { name: "Summary" }).click();
    await expect(a!.getByRole("heading").first()).toBeVisible();
    await shot(a!, "6-summary");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
