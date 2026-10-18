import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { appUrl } from "./helpers/app";
import { pdfText } from "./helpers/pdf";
import { printed, printToPdf, stubPrint } from "./helpers/print";

const SESSION = "Desk <b>1</b>";
const MM_72_IN_PT = (72 / 25.4) * 72;

async function pdfPageWidths(path: string): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(await readFile(path)) });
  try {
    const doc = await task.promise;
    const widths: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      widths.push((await doc.getPage(n)).getViewport({ scale: 1 }).width);
    }
    return widths;
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
  for (const line of [SESSION, "Clerk: Ann", "Patron: P1", "I1", "Items: 1"]) {
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
  for (const line of ["Patron: P2", "I9", "Items: 1"]) expect(second.text).toContain(line);
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
  const widths = await pdfPageWidths(pdf);
  expect(widths).toHaveLength(1);
  expect(Math.abs(widths[0] - MM_72_IN_PT)).toBeLessThan(0.5);
  expect(await pdfText(pdf)).toContain("Patron: P1");
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
