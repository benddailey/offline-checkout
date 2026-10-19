import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { appUrl } from "./helpers/app";
import { pdfText } from "./helpers/pdf";
import {
  decodePrintedBarcodes,
  inkExtentMm,
  printed,
  type Printed,
  printToPdf,
  stubPrint,
} from "./helpers/print";

const SESSION = "Desk <b>1</b>";

async function pdfPageSizes(path: string): Promise<{ width: number; height: number }[]> {
  const task = getDocument({ data: new Uint8Array(await readFile(path)) });
  try {
    const doc = await task.promise;
    const sizes: { width: number; height: number }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
      sizes.push({ width, height });
    }
    return sizes;
  } finally {
    await task.destroy();
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("ending a patron prints a 72 mm receipt and gives focus back to the scanner", async ({
  page,
}) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill(SESSION);
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();

  const input = page.getByLabel("Scanner input");
  await expect(input).toBeFocused();
  await page.keyboard.type("P1\nI1\nI2\n");
  await expect(page.getByTestId("item")).toHaveCount(2);
  await page.getByRole("button", { name: "Void I2" }).click();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  expect(await printed(page)).toHaveLength(0);

  const dayBefore = today();
  await page.getByRole("button", { name: "End patron" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const dayAfter = today();
  const [first] = await printed(page);
  for (const line of [SESSION, "Clerk: Ann", "Patron", "P1", "Item 1 of 1", "I1", "Items: 1"]) {
    expect(first.text).toContain(line);
  }
  expect(first.text).not.toContain("I2");
  expect([dayBefore, dayAfter].some((d) => first.text.includes(d))).toBe(true);
  // The ended patron is already gone from the screen behind the print dialog.
  expect(first.screen).toContain("Scan patron card");
  expect(first.screen).not.toContain("Void patron");
  expect(first.painted).toBe(true);
  await expect(page.locator("#oc-print-root")).toHaveCount(0);
  await expect(page.getByText("Scan patron card")).toBeVisible();

  await expect(input).toBeFocused();
  await page.keyboard.type("P2\n");
  await expect(page.getByTestId("patron")).toHaveText("P2");
  await page.keyboard.type("I9\nOC-END\n");
  await expect.poll(async () => (await printed(page)).length).toBe(2);
  const second = (await printed(page))[1];
  for (const line of ["P2", "Item 1 of 1", "I9", "Items: 1"]) expect(second.text).toContain(line);
  expect(second.screen).toContain("Scan patron card");
  expect(second.painted).toBe(true);

  await expect(input).toBeFocused();
  await page.keyboard.type("OC-END\n");
  await expect(page.getByTestId("message")).toHaveText("No patron in progress");
  expect(await printed(page)).toHaveLength(2);
  await expect(page.locator("#oc-print-root")).toHaveCount(0);

  await page.reload();
  await page.getByTestId("resume-list").getByRole("button", { name: SESSION }).click();
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");

  const pdf = await printToPdf(first.html, "receipt-print/receipt-p1.pdf");
  const sizes = await pdfPageSizes(pdf);
  expect(sizes).toHaveLength(1);
  expect((await inkExtentMm(pdf))!.top).toBeLessThan(10);
  const text = await pdfText(pdf);
  for (const line of ["Patron", "Item 1 of 1", "Items: 1"]) expect(text).toContain(line);
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual(["P1", "I1"]);
  }
});

async function endVisit(page: Page, scans: string[]): Promise<Printed> {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Long visit");
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeFocused();
  await page.keyboard.type(`${scans.join("\n")}\nOC-END\n`);
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  return (await printed(page))[0];
}

test("a 12-item visit prints one barcode per code down a single tall page", async ({ page }) => {
  const items = Array.from({ length: 12 }, (_, i) => `ITEM${i + 1}`);
  const receipt = await endVisit(page, ["P1", ...items]);
  const pdf = await printToPdf(receipt.html, "receipt-print/receipt-12.pdf");
  const sizes = await pdfPageSizes(pdf);
  expect(sizes).toHaveLength(1);
  expect((await inkExtentMm(pdf))!.top).toBeLessThan(10);
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual(["P1", ...items]);
  }
});

test("a visit with no items prints the patron and a single rule", async ({ page }) => {
  const receipt = await endVisit(page, ["P1"]);
  expect(receipt.text).toContain("Items: 0");
  const rules = await page.evaluate((html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.querySelectorAll(".oc-visit-rule").length;
  }, receipt.html);
  expect(rules).toBe(1);
  const pdf = await printToPdf(receipt.html, "receipt-print/receipt-empty.pdf");
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual(["P1"]);
  }
});

test("an item too long for the paper prints as text, not a barcode", async ({ page }) => {
  const long = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD";
  const receipt = await endVisit(page, ["P1", "I1", long, "I2"]);
  expect(receipt.text).toContain("Too long for a barcode — type it in");
  expect(receipt.text).toContain(long);
  const pdf = await printToPdf(receipt.html, "receipt-print/receipt-long.pdf");
  // The 40 characters wrap onto two lines.
  expect((await pdfText(pdf)).replace(/\s/g, "")).toContain(long);
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual(["P1", "I1", "I2"]);
  }
});

test("the scanner input takes focus back when the print dialog closes", async ({ page }) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Focus");
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();
  const input = page.getByLabel("Scanner input");
  await expect(input).toBeFocused();
  await page.keyboard.type("P1\n");
  await expect(page.getByTestId("patron")).toHaveText("P1");

  // Park focus in another text field (the scanner input never takes focus from one), so only
  // afterprint can give it back: the dialog, not a blur of the scanner input, takes focus.
  await page.evaluate(() => {
    const other = document.createElement("input");
    other.id = "other-field";
    document.body.append(other);
    other.focus();
  });
  await page.waitForTimeout(50);
  await expect(page.locator("#other-field")).toBeFocused();
  await page.getByRole("button", { name: "End patron" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  await expect(input).toBeFocused();
  await page.keyboard.type("P2\n");
  await expect(page.getByTestId("patron")).toHaveText("P2");
});

test("a failed print leaves no print container and tells the clerk", async ({ page }) => {
  await stubPrint(page, { throws: true });
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Broken printer");
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeFocused();
  await page.keyboard.type("P1\nI1\nOC-END\n");
  await expect(page.getByTestId("message")).toHaveText("Could not print the receipt");
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.locator("#oc-print-root")).toHaveCount(0);
  await expect(page.locator("#oc-print-style")).toHaveCount(0);
});

test("on the receipt printer's roll paper the receipt starts at the top, so nothing feeds before it", async ({
  page,
}) => {
  const receipt = await endVisit(page, ["P1", "I1", "I2"]);
  const pdf = await printToPdf(receipt.html, "receipt-print/receipt-roll.pdf");
  const ink = await inkExtentMm(pdf);
  expect(ink).not.toBeNull();
  expect(ink!.top).toBeLessThan(10);
  expect(ink!.bottom).toBeLessThan(150);
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual(["P1", "I1", "I2"]);
  }
});

test("the scanner card prints on the receipt printer at the top of the roll", async ({ page }) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Card");
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Receipt printer" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(1);
  const [card] = await printed(page);
  for (const line of ["Scanner card", "End patron", "Void last item"]) {
    expect(card.text).toContain(line);
  }
  expect(card.screen).not.toContain("Print the scanner card");
  await expect(page.getByLabel("Scanner input")).toBeFocused();

  const pdf = await printToPdf(card.html, "receipt-print/scanner-card.pdf");
  const ink = await inkExtentMm(pdf);
  expect(ink!.top).toBeLessThan(10);
  expect(ink!.bottom).toBeLessThan(150);
  for (const colour of ["gray", "mono"] as const) {
    expect((await decodePrintedBarcodes(pdf, colour)).code128, colour).toEqual([
      "OC-END",
      "OC-VOIDLAST",
    ]);
  }
});
