import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";

async function start(page: Page, name: string, clerk: string): Promise<void> {
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill(name);
  await page.getByLabel("Clerk name").fill(clerk);
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeVisible();
}

test("a patron scanned on Add workstation opens on the scan screen; the paste box still types", async ({
  page,
}) => {
  await start(page, "Pair Scan", "Rae");

  await page.getByRole("button", { name: "Add workstation" }).click();
  await expect(page.getByLabel("Join code", { exact: true })).not.toHaveValue("", {
    timeout: 15_000,
  });
  const box = page.getByLabel("Pasted code");
  await box.fill("");
  await box.pressSequentially("OC1:abc");
  await expect(box).toHaveValue("OC1:abc");

  // A control code is answered here; a patron card leaves for the scan screen.
  await page.getByRole("heading", { name: "Add workstation" }).click();
  await page.keyboard.type("OC-END\n");
  await expect(page.getByTestId("message")).toHaveText("No patron in progress");
  await expect(page.getByRole("heading", { name: "Add workstation" })).toBeVisible();
  await page.keyboard.type("P1\n");
  await expect(page.getByTestId("patron")).toHaveText("P1");
  await expect(page.getByRole("button", { name: "Add workstation" })).toBeDisabled();
  await page.keyboard.type("I1\n");
  await expect(page.getByTestId("item")).toContainText("I1");
});

test("the summary names unconnected workstations, confirms before PDF and close, then goes back to start", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await start(a!, "Warn", "Ann");
    await b!.goto(appUrl());
    await pairViaPaste(a!, b!, "Ben");
    await b!.keyboard.type("P2\n");
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 1 · Items 0", { timeout: 5_000 });

    await a!.getByRole("button", { name: "Summary" }).click();
    await expect(a!.getByTestId("not-connected")).toBeHidden();
    // Generate PDF with everyone connected needs no confirmation.
    await Promise.all([
      a!.waitForEvent("download"),
      a!.getByRole("button", { name: "Generate PDF" }).click(),
    ]);
    await expect(a!.getByRole("alertdialog")).toBeHidden();
    // Only Close session warns about open patrons.
    await expect(a!.getByTestId("in-progress")).toBeHidden();

    await contexts[1]!.close();
    await expect(a!.getByTestId("not-connected")).toHaveText(
      "Not connected: Ben — their latest scans may be missing",
      { timeout: 30_000 },
    );

    let downloads = 0;
    a!.on("download", () => downloads++);
    await a!.getByRole("button", { name: "Generate PDF" }).click();
    const dialog = a!.getByRole("alertdialog");
    await expect(dialog).toContainText("Not connected: Ben");
    await a!.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(downloads).toBe(0);
    await a!.getByRole("button", { name: "Generate PDF" }).click();
    await Promise.all([
      a!.waitForEvent("download"),
      a!.getByRole("button", { name: "Generate anyway" }).click(),
    ]);

    await a!.getByRole("button", { name: "Close session" }).click();
    await expect(dialog).toContainText(
      "Close this session for all workstations? Scanning will stop everywhere.",
    );
    await expect(dialog).toContainText("Not connected: Ben");
    await expect(dialog.getByTestId("in-progress")).toHaveText(
      "Patron in progress: P2 (Ben). Their visits will stay open.",
    );
    await a!.getByRole("button", { name: "Yes, close session" }).click();
    await expect(a!.getByText("Session closed", { exact: true })).toBeVisible();

    await a!.getByRole("button", { name: "Back to start" }).click();
    await expect(a!.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
    await expect(a!.getByTestId("resume-list")).toContainText("Warn");
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
  }
});

test("a session already open in another tab shows a dismissable notice on Launch", async ({
  context,
}) => {
  const first = await context.newPage();
  await start(first, "Two Tabs", "Rae");
  const second = await context.newPage();
  await second.goto(appUrl());
  await second
    .getByTestId("resume-list")
    .getByRole("button", { name: /Two Tabs/ })
    .click();
  const notice = second.getByTestId("notice");
  await expect(notice).toContainText("This session is already open in another tab");
  await expect(second.getByRole("heading", { name: "Stop" })).toBeHidden();
  await expect(second.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();
});
