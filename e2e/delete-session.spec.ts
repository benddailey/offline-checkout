import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { stubPrint } from "./helpers/print";

async function scan(page: Page, ...codes: string[]): Promise<void> {
  for (const code of codes) await page.keyboard.type(`${code}\n`);
}

async function startSession(page: Page): Promise<void> {
  await page.getByLabel("Session name").fill("Outage");
  await page.getByLabel("Clerk name").fill("Ann");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeVisible();
}

async function closeSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("button", { name: "Yes, close session" }).click();
  await expect(page.getByText("Session closed", { exact: true })).toBeVisible();
}

test("a closed session is deleted on two workstations with the slide control", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const [page, desk] of [
      [a!, "Front desk"],
      [b!, "Back desk"],
    ] as const) {
      await stubPrint(page);
      await openApp(page, desk);
    }
    await startSession(a!);
    await pairViaPaste(a!, b!, "Ben");

    await scan(a!, "P1", "I1", "OC-END");
    await expect(b!.getByTestId("totals")).toHaveText("Patrons 1 · Items 1", { timeout: 5_000 });
    await b!.getByRole("button", { name: "Summary" }).click();
    await expect(b!.getByRole("button", { name: "Delete session" })).toBeHidden();

    await closeSession(a!);
    const [file] = await Promise.all([
      a!.waitForEvent("download"),
      a!.getByRole("button", { name: "Download for Evergreen" }).click(),
    ]);
    await file.cancel();

    await expect(b!.getByText("Session closed", { exact: true })).toBeVisible({ timeout: 5_000 });
    await b!.getByRole("button", { name: "Delete session" }).click();
    const dialog = b!.getByRole("alertdialog");
    await expect(dialog).toContainText("Evergreen file: downloaded", { timeout: 5_000 });
    await expect(dialog).toContainText("(Front desk)");
    await expect(dialog).not.toContainText("Download the Evergreen file first");

    const slider = dialog.getByRole("slider");
    await slider.focus();
    await b!.keyboard.press("Enter");
    await expect(dialog).toBeVisible();

    const box = (await slider.boundingBox())!;
    const track = (await slider.locator("xpath=..").boundingBox())!;
    await b!.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await b!.mouse.down();
    await b!.mouse.move(track.x + track.width / 2, box.y + box.height / 2, { steps: 5 });
    await b!.mouse.move(track.x + track.width + 20, box.y + box.height / 2, { steps: 5 });
    await b!.mouse.up();

    await expect(b!.getByTestId("notice")).toContainText("Session ‘Outage’ deleted.", {
      timeout: 10_000,
    });
    await expect(b!.getByTestId("resume-list")).toBeHidden();

    await expect(a!.getByTestId("notice")).toContainText(
      "Session ‘Outage’ was deleted on Back desk.",
      { timeout: 10_000 },
    );
    await expect(a!.getByTestId("resume-list")).toBeHidden();
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("a session with no exports warns about Evergreen and deletes with the End key", async ({
  page,
}) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page);
  await scan(page, "P1", "I1", "OC-END");
  await closeSession(page);

  await page.getByRole("button", { name: "Delete session" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Download the Evergreen file first");
  await dialog.getByRole("slider").focus();
  await page.keyboard.press("End");

  await expect(page.getByTestId("notice")).toContainText("Session ‘Outage’ deleted.");
  await expect(page.getByTestId("resume-list")).toBeHidden();
});
