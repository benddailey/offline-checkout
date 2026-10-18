import { expect, test } from "@playwright/test";
import { appUrl } from "./helpers/app";
import { stubPrint } from "./helpers/print";

test("scan, void, end patron and resume after reload", async ({ page }) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Scan Test");
  await page.getByLabel("Clerk name").fill("Rae");
  await page.getByRole("button", { name: "Start session" }).click();

  const input = page.getByLabel("Scanner input");
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Print scanner card" })).toBeVisible();

  await page.keyboard.type("p1\n");
  await expect(page.getByTestId("patron")).toHaveText("P1");
  await page.keyboard.type("I1\n");
  await page.keyboard.type("I2\n");
  await expect(page.getByTestId("item")).toHaveCount(2);

  // Clicking empty space moves focus away; the scanner input takes it back.
  await page.getByTestId("patron").click();
  await expect(input).toBeFocused();
  await page.keyboard.type("i1\n");
  await expect(page.getByTestId("message")).toHaveText("Already on this patron — not added");
  await expect(page.getByTestId("item")).toHaveCount(2);

  await page.getByRole("button", { name: "Void I2" }).click();
  await expect(
    page.getByTestId("item").filter({ hasText: "I2" }).locator(".line-through"),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");

  // A scan arriving while a button holds focus must not press that button.
  await page.getByRole("button", { name: "Void patron" }).focus();
  await page.keyboard.type("I3\n");
  await expect(page.getByTestId("patron")).toHaveText("P1");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 2");
  await page.keyboard.type("OC-VOIDLAST\n");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");

  await page.keyboard.type("OC-END\n");
  await expect(page.getByText("Scan patron card")).toBeVisible();

  await page.reload();
  await page
    .getByTestId("resume-list")
    .getByRole("button", { name: /Scan Test/ })
    .click();
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  // Only this workstation has ever been in the session: nothing to re-pair with.
  await expect(page.getByText("Disconnected — re-pair with any workstation")).toBeHidden();
});
