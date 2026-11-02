import { expect, test, type Page } from "@playwright/test";
import { openApp, resumeAs, startSession } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { stubPrint } from "./helpers/print";

/** The StatusBar entry for `name` shows a green (connected) dot. */
async function expectConnected(page: Page, name: string): Promise<void> {
  const entry = page.getByTestId("status-bar").getByRole("listitem").filter({ hasText: name });
  await expect(entry.getByLabel("connected", { exact: true })).toBeVisible({ timeout: 10_000 });
}

test("three workstations pair by paste, form a mesh and sync scans", async ({ browser }) => {
  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  try {
    const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    for (const page of [a!, b!, c!]) await openApp(page);

    await startSession(a!, "Outage", "Ann");

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
    await openApp(d);
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
    await expect(a!.getByText(/Expires in 1[45]:\d\d/)).toBeVisible();
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
    for (const page of [a!, b!, other!]) {
      await stubPrint(page);
      await openApp(page);
    }
    await startSession(a!, "Outage", "Ann");
    await startSession(other!, "Elsewhere", "Oz");
    await pairViaPaste(a!, b!, "Ben");
    await expectConnected(a!, "Ben");

    await b!.reload();
    await resumeAs(b!, /Outage/, "Ben");
    await expect(b!.getByText("Disconnected — re-pair with any workstation")).toBeVisible();
    await b!.keyboard.type("P2\n");
    await expect(b!.getByTestId("patron")).toHaveText("P2");
    await expect(b!.getByRole("button", { name: "Re-pair" })).toBeDisabled();
    await b!.keyboard.type("OC-END\n");
    await expect(b!.getByRole("button", { name: "Re-pair" })).toBeEnabled();

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

test("the start page lists other named workstations from the open sessions", async ({
  browser,
}) => {
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await openApp(a!, "Front desk");
    await openApp(b!, "Back desk");
    await expect(a!.getByRole("heading", { name: "Start new session" })).toBeVisible();
    await expect(a!.getByRole("heading", { name: "Other workstations" })).toBeHidden();

    await startSession(a!, "Outage", "Ann");
    await pairViaPaste(a!, b!, "Ben");

    await b!.keyboard.type("P1\n");
    await expect(b!.getByTestId("patron")).toHaveText("P1");
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 1 · Items 0", { timeout: 5_000 });

    await a!.reload();
    const list = a!.getByTestId("other-workstations");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Back desk");
    await expect(list).toContainText("Outage");
    await expect(list).not.toContainText("Front desk");
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
