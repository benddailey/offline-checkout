import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";

/** The StatusBar entry for `name` shows a green (connected) dot. */
async function expectConnected(page: Page, name: string): Promise<void> {
  const entry = page.getByTestId("status-bar").getByRole("listitem").filter({ hasText: name });
  await expect(entry.getByLabel("connected", { exact: true })).toBeVisible({ timeout: 10_000 });
}

test("three workstations pair by paste, form a mesh and sync scans", async ({ browser }) => {
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  try {
    const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const page of [a!, b!, c!]) await page.goto(appUrl());

    await a!.getByLabel("Session name").fill("Outage");
    await a!.getByLabel("Clerk name").fill("Ann");
    await a!.getByRole("button", { name: "Start session" }).click();
    await expect(a!.getByLabel("Scanner input")).toBeVisible();

    const first = await pairViaPaste(a!, b!, "Ben");
    await pairViaPaste(a!, c!, "Cat");

    // B and C were never paired directly: their link comes from A's introduction.
    await expectConnected(a!, "Ben");
    await expectConnected(a!, "Cat");
    await expectConnected(b!, "Ann");
    await expectConnected(b!, "Cat");
    await expectConnected(c!, "Ann");
    await expectConnected(c!, "Ben");
    for (const page of [a!, b!, c!]) {
      await expect(page.getByTestId("status-bar")).toContainText("Outage");
      await expect(page.getByText("Disconnected — re-pair with any workstation")).toBeHidden();
    }

    await b!.keyboard.type("P1\n");
    await expect(b!.getByTestId("patron")).toHaveText("P1");
    await b!.keyboard.type("I1\n");
    await expect(b!.getByTestId("item")).toHaveCount(1);
    for (const page of [a!, c!]) {
      await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1", {
        timeout: 3_000,
      });
    }

    // A reply code pasted where a join code belongs.
    const d = await contexts[2]!.newPage();
    await d.goto(appUrl());
    await d.getByRole("button", { name: "Join session" }).click();
    await d.getByLabel("Pasted code").fill(first.answer);
    await d.getByRole("button", { name: "Use pasted code" }).click();
    await expect(d.getByRole("alert")).toContainText("That is a reply code");
    await d.getByRole("button", { name: "Try again" }).click();
    await expect(d.getByLabel("Pasted code")).toHaveValue("");

    // A join code pasted where a reply code belongs.
    await a!.getByRole("button", { name: "Add workstation" }).click();
    await a!.getByLabel("Pasted code").fill(first.offer);
    await a!.getByRole("button", { name: "Use pasted code" }).click();
    await expect(a!.getByRole("alert")).toContainText("That is a join code, not a reply code");
    await a!.getByRole("button", { name: "Try again" }).click();
    await expect(a!.getByLabel("Join code", { exact: true })).not.toHaveValue(first.offer);
    await expect(a!.getByText(/Expires in [45]:\d\d/)).toBeVisible();
    await a!.getByRole("button", { name: "Back" }).click();
    await expect(a!.getByLabel("Scanner input")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("an isolated workstation re-pairs only with its own session", async ({ browser }) => {
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  try {
    const [a, b, other] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const page of [a!, b!, other!]) await page.goto(appUrl());
    for (const [page, session, clerk] of [
      [a!, "Outage", "Ann"],
      [other!, "Elsewhere", "Oz"],
    ] as const) {
      await page.getByLabel("Session name").fill(session);
      await page.getByLabel("Clerk name").fill(clerk);
      await page.getByRole("button", { name: "Start session" }).click();
      await expect(page.getByLabel("Scanner input")).toBeVisible();
    }
    await pairViaPaste(a!, b!, "Ben");
    await expectConnected(a!, "Ben");

    await b!.reload();
    await b!
      .getByTestId("resume-list")
      .getByRole("button", { name: /Outage/ })
      .click();
    await expect(b!.getByText("Disconnected — re-pair with any workstation")).toBeVisible();
    await b!.keyboard.type("P2\n");
    await expect(b!.getByTestId("patron")).toHaveText("P2");

    // Another session's join code is refused.
    await other!.getByRole("button", { name: "Add workstation" }).click();
    const foreign = other!.getByLabel("Join code", { exact: true });
    await expect(foreign).not.toHaveValue("", { timeout: 15_000 });
    await b!.getByRole("button", { name: "Re-pair" }).click();
    await b!.getByLabel("Pasted code").fill(await foreign.inputValue());
    await b!.getByRole("button", { name: "Use pasted code" }).click();
    await expect(b!.getByRole("alert")).toHaveText("That code is for a different session.");
    await b!.getByRole("button", { name: "Back" }).click();

    await pairViaPaste(a!, b!, "Ben");
    await expectConnected(a!, "Ben");
    await expectConnected(b!, "Ann");
    await expect(b!.getByText("Disconnected — re-pair with any workstation")).toBeHidden();
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 1 · Items 0", { timeout: 3_000 });
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
