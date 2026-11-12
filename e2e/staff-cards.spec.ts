import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/app";
import { decodePdfBarcodes, pdfText } from "./helpers/pdf";

test("staff barcodes: fill the rest, keep case, and print a scannable Avery 5371 sheet", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Print staff barcodes" }).click();
  await expect(page.getByRole("heading", { name: "Staff barcodes" })).toBeVisible();
  const card = (n: number) => page.getByLabel(`Card ${n}`, { exact: true });
  const fill = (n: number) => page.getByRole("button", { name: `Fill the rest from card ${n}` });
  const generate = page.getByRole("button", { name: "Generate PDF" });

  await expect(generate).toBeDisabled();
  await expect(fill(1)).toBeDisabled();
  await expect(fill(10)).toHaveCount(0);

  await card(1).fill("bdailey");
  await fill(1).click();
  for (let n = 1; n <= 10; n++) await expect(card(n)).toHaveValue("bdailey");
  await card(6).fill("  JDailey ");
  await fill(6).click();
  for (let n = 1; n <= 5; n++) await expect(card(n)).toHaveValue("bdailey");
  for (let n = 6; n <= 10; n++) await expect(card(n)).toHaveValue("  JDailey ");

  await card(3).fill("josé");
  await expect(page.getByText('Can\'t go in a barcode: "é"')).toBeVisible();
  await expect(generate).toBeDisabled();
  await card(3).fill("");

  const [download] = await Promise.all([page.waitForEvent("download"), generate.click()]);
  expect(download.suggestedFilename()).toBe("staff-barcodes.pdf");
  const pdf = await download.path();
  const words = (await pdfText(pdf)).split(/\s+/).filter(Boolean);
  expect(words).toEqual([...Array(4).fill("bdailey"), ...Array(5).fill("JDailey")]);
  const decoded = await decodePdfBarcodes(pdf);
  expect(decoded).toHaveLength(9);
  expect(decoded.filter((t) => t === "bdailey")).toHaveLength(4);
  expect(decoded.filter((t) => t === "JDailey")).toHaveLength(5);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Print staff barcodes" })).toBeVisible();
});
