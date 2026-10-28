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
  await expect(page.getByRole("button", { name: "Receipt printer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Letter PDF" })).toBeVisible();

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
  const open = page.getByTestId("resume-list").getByRole("button", { name: /Scan Test/ });
  await expect(open).toContainText("Started");
  await expect(open.getByTestId("session-closed")).toBeHidden();
  await open.click();
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  // Only this workstation has ever been in the session: nothing to re-pair with.
  await expect(page.getByText("Disconnected — re-pair with any workstation")).toBeHidden();
});

test("a patron in progress locks leaving the scan screen and asks before the tab closes", async ({
  page,
}) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Lock Test");
  await page.getByLabel("Clerk name").fill("Rae");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Not now" }).click();

  const summary = page.getByRole("button", { name: "Summary" });
  const add = page.getByRole("button", { name: "Add workstation" });
  await expect(summary).toBeEnabled();
  await page.keyboard.type("P1\nI1\n");
  await expect(page.getByTestId("item")).toHaveCount(1);
  await expect(summary).toBeDisabled();
  await expect(add).toBeDisabled();
  await expect(page.getByTestId("finish-patron")).toHaveText(
    "Finish patron P1 first: End patron or Void patron",
  );
  await expect(summary).toHaveAccessibleDescription(
    "Finish patron P1 first: End patron or Void patron",
  );

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  expect(page.isClosed()).toBe(false);

  await page.keyboard.type("OC-END\n");
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.getByTestId("finish-patron")).toBeHidden();
  await expect(add).toBeEnabled();
  await summary.click();
  await expect(page.getByRole("heading", { name: "Session summary" })).toBeVisible();

  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(dialogs).toEqual(["beforeunload"]);
});

test("the scanner card offer closes once the first patron is scanned", async ({ page }) => {
  await stubPrint(page);
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill("Offer Test");
  await page.getByLabel("Clerk name").fill("Rae");
  await page.getByRole("button", { name: "Start session" }).click();

  const offer = page.getByText("Print the scanner card with the");
  await expect(offer).toBeVisible();
  await page.keyboard.type("P1\n");
  await expect(page.getByTestId("patron")).toHaveText("P1");
  await expect(offer).toBeHidden();
});
