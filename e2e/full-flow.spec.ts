import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { decodePdfBarcodes, pdfText } from "./helpers/pdf";
import { stubPrint } from "./helpers/print";

/** Click `button` on `page`, wait for the download it starts and save it under test-results/. */
async function download(page: Page, button: string, saveAs: string): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button }).click(),
  ]);
  const path = resolve("test-results", "full-flow", saveAs);
  await file.saveAs(path);
  return path;
}

async function scan(page: Page, ...codes: string[]): Promise<void> {
  for (const code of codes) await page.keyboard.type(`${code}\n`);
}

test("two workstations scan, close the session and export a PDF whose barcodes decode", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const page of [a!, b!]) {
      await stubPrint(page);
      await page.goto(appUrl());
    }
    let downloadsOnA = 0;
    a!.on("download", () => downloadsOnA++);

    await a!.getByLabel("Session name").fill("Outage");
    await a!.getByLabel("Clerk name").fill("Ann");
    await a!.getByRole("button", { name: "Start session" }).click();
    await expect(a!.getByLabel("Scanner input")).toBeVisible();

    // The scanner card offered at session start downloads and scans as the control codes.
    const card = await download(a!, "Print scanner card", "scanner-card.pdf");
    expect((await decodePdfBarcodes(card)).sort()).toEqual(["OC-END", "OC-VOIDLAST"]);

    // Nothing scanned yet: no PDF to generate.
    await a!.getByRole("button", { name: "Summary" }).click();
    await expect(a!.getByRole("button", { name: "Generate PDF" })).toBeDisabled();
    await expect(a!.getByText("Scan at least one patron first")).toBeVisible();
    // The summary's own scanner card button.
    await download(a!, "Print scanner card", "scanner-card-from-summary.pdf");
    expect(downloadsOnA).toBe(2);

    // A scan made on the summary is recorded on the scan screen; its Enter presses no button.
    await a!.getByRole("button", { name: "Print scanner card" }).focus();
    await scan(a!, "P1");
    await expect(a!.getByRole("heading", { name: "Session summary" })).toBeHidden();
    await expect(a!.getByTestId("patron")).toHaveText("P1");
    await a!.waitForTimeout(500);
    expect(downloadsOnA).toBe(2);

    await pairViaPaste(a!, b!, "Ben");

    // A: P1 with I1 and I2, then I2 voided.
    await scan(a!, "I1", "I2");
    await expect(a!.getByTestId("item")).toHaveCount(2);
    await a!.getByRole("button", { name: "Void I2" }).click();
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");

    // B: P2 with I3 and I1 (already on P1).
    await expect(b!.getByTestId("totals")).toHaveText("Patrons 1 · Items 1", { timeout: 5_000 });
    await scan(b!, "P2", "I3", "I1");
    await expect(b!.getByTestId("item")).toHaveCount(2);
    await expect(b!.getByTestId("message")).toHaveText("Also on patron P1");
    await scan(b!, "OC-END");
    await expect(b!.getByText("Scan patron card")).toBeVisible();

    // B: P3 with I4, then the whole patron voided.
    await scan(b!, "P3", "I4");
    await expect(b!.getByTestId("item")).toHaveCount(1);
    await b!.getByRole("button", { name: "Void patron" }).click();
    await expect(b!.getByText("Scan patron card")).toBeVisible();

    // A ends P1 with the scanner card's code.
    await scan(a!, "OC-END");
    await expect(a!.getByText("Scan patron card")).toBeVisible();
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 2 · Items 3", { timeout: 5_000 });

    // A closes the session; B stops accepting scans.
    await a!.getByRole("button", { name: "Summary" }).click();
    await a!.getByRole("button", { name: "Close session" }).click();
    await expect(a!.getByRole("alertdialog")).toContainText(
      "Close this session for all workstations? Scanning will stop everywhere.",
    );
    // While the dialog is open a scan is dropped and presses no dialog button.
    await expect(a!.getByRole("button", { name: "Cancel" })).toBeFocused();
    await scan(a!, "P8");
    await expect(a!.getByRole("alertdialog")).toBeVisible();
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 2 · Items 3");
    // Tab stays inside the dialog.
    await a!.keyboard.press("Tab");
    await expect(a!.getByRole("button", { name: "Yes, close session" })).toBeFocused();
    await a!.keyboard.press("Shift+Tab");
    await expect(a!.getByRole("button", { name: "Cancel" })).toBeFocused();
    await a!.getByRole("button", { name: "Yes, close session" }).click();
    await expect(a!.getByText("Session closed", { exact: true })).toBeVisible();
    await expect(a!.getByRole("button", { name: "Close session" })).toBeHidden();

    await expect(b!.getByText("Session closed", { exact: true })).toBeVisible({ timeout: 5_000 });
    await scan(b!, "P9");
    await expect(b!.getByTestId("message")).toHaveText("Session closed");
    await expect(b!.getByText("Scan patron card")).toBeVisible();
    await expect(b!.getByTestId("totals")).toHaveText("Patrons 2 · Items 3");

    // B's summary shows the whole session and still exports the PDF.
    await b!.getByRole("button", { name: "Summary" }).click();
    const summary = b!.getByTestId("summary-patrons");
    await expect(summary.getByTestId("summary-patron")).toHaveCount(3);
    await expect(summary.getByTestId("summary-patron").nth(0)).toContainText("P1");
    await expect(summary.getByTestId("summary-patron").nth(1)).toContainText("P2");
    await expect(summary.locator(".line-through", { hasText: "I2" })).toBeVisible();
    await expect(summary.locator(".line-through", { hasText: "P3" })).toBeVisible();
    await expect(b!.getByTestId("per-clerk")).toContainText("Ann: 1 patron, 1 item");
    await expect(b!.getByTestId("per-clerk")).toContainText("Ben: 1 patron, 2 items");

    const [file] = await Promise.all([
      b!.waitForEvent("download"),
      b!.getByRole("button", { name: "Generate PDF" }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/^offline-checkout-Outage-\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = resolve("test-results", "full-flow", file.suggestedFilename());
    await file.saveAs(pdf);

    expect((await decodePdfBarcodes(pdf)).sort()).toEqual(["I1", "I1", "I3", "P1", "P2"]);
    const text = await pdfText(pdf);
    expect(text).toContain("Page 1 of 1");
    expect(text).toContain("Patrons: 2");
    expect(text).toContain("Items: 3");
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
