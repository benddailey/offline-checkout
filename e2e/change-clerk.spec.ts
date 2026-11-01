import { expect, test, type Page } from "@playwright/test";
import { appUrl, resumeAs } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { stubPrint } from "./helpers/print";

async function start(page: Page, session: string, clerk: string): Promise<void> {
  await page.goto(appUrl());
  await page.getByLabel("Session name").fill(session);
  await page.getByLabel("Clerk name").fill(clerk);
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
}

test("change clerk, exit and resume as someone else, each needing a typed name", async ({
  page,
}) => {
  await stubPrint(page);
  await start(page, "Shifts", "Rae");
  const bar = page.getByTestId("status-bar");
  await page.keyboard.type("P1\nI1\n");
  await expect(page.getByTestId("item")).toHaveCount(1);

  // Not while a patron is open on this workstation.
  const change = page.getByRole("button", { name: "Change clerk" });
  const exit = page.getByRole("button", { name: "Exit session" });
  await expect(change).toBeDisabled();
  await expect(exit).toBeDisabled();
  await page.keyboard.type("OC-END\n");
  await expect(page.getByText("Scan patron card")).toBeVisible();

  await change.click();
  const dialog = page.getByRole("dialog", { name: "Change clerk" });
  const name = dialog.getByLabel("Clerk name");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await dialog.getByRole("button", { name: "Change clerk" }).click();
  await expect(dialog).toContainText("Enter your name.");
  await name.fill("Sam");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(bar).toContainText("Shifts · Sam");

  await page.keyboard.type("P2\nI2\nOC-END\n");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");

  // Alone in the session: nothing to disconnect from, so no confirmation.
  await exit.click();
  await expect(page.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
  const row = page.getByTestId("resume-list").getByRole("button", { name: /Shifts/ });
  await expect(row).toContainText("Sam");

  // The session was just used, so it opens expanded with its clerk field focused and empty.
  const form = page.getByTestId("resume-form");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByLabel("Clerk name")).toBeFocused();
  await expect(form.getByLabel("Clerk name")).toHaveValue("");
  await form.getByRole("button", { name: "Resume session" }).click();
  await expect(form).toContainText("Enter your name to resume.");
  await row.click();
  await expect(form).toBeHidden();

  await resumeAs(page, /Shifts/, "Tom");
  await expect(bar).toContainText("Shifts · Tom");
  await page.keyboard.type("P3\nOC-END\n");
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByTestId("per-clerk")).toContainText("Rae");
  await expect(page.getByTestId("per-clerk")).toContainText("Sam");
  await expect(page.getByTestId("per-clerk")).toContainText("Tom");
});

test("other workstations see a changed clerk; exiting while connected asks first", async ({
  browser,
}) => {
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await start(a!, "Desk", "Ann");
    await b!.goto(appUrl());
    await pairViaPaste(a!, b!, "Ben");
    const benOnA = a!.getByTestId("status-bar").getByRole("listitem").filter({ hasText: "Ben" });
    await expect(benOnA.getByLabel("connected", { exact: true })).toBeVisible({ timeout: 10_000 });

    await b!.getByRole("button", { name: "Change clerk" }).click();
    await b!.getByRole("dialog").getByLabel("Clerk name").fill("Bo");
    await b!.keyboard.press("Enter");
    const boOnA = a!.getByTestId("status-bar").getByRole("listitem").filter({ hasText: "Bo" });
    await expect(boOnA.getByLabel("connected", { exact: true })).toBeVisible();

    await a!.getByRole("button", { name: "Exit session" }).click();
    const confirm = a!.getByRole("alertdialog", { name: "Exit session" });
    await expect(confirm).toContainText("This workstation will disconnect from the others.");
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await a!.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await a!.getByRole("button", { name: "Exit session" }).click();
    await confirm.getByRole("button", { name: "Yes, exit session" }).click();
    await expect(a!.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
    await expect(b!.getByText("Disconnected — re-pair with any workstation")).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
  }
});
