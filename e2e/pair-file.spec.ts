import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openApp, startSession } from "./helpers/app";

/** Replace Chrome's save dialog with one that keeps what was written, as the dialog can't be driven. */
async function stubSavePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.savedFiles = [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (blob: Blob) =>
          w.savedFiles.push({ name: o.suggestedName, text: await blob.text() }),
        close: async () => {},
      }),
    });
  });
}

async function saved(page: Page): Promise<{ name: string; text: string }> {
  await page.getByRole("button", { name: "Save to file" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  return page.evaluate(() => (window as any).savedFiles.at(-1));
}

async function load(page: Page, file: { name: string; text: string }): Promise<void> {
  await page.getByTestId("code-file").setInputFiles({
    name: file.name,
    mimeType: "text/plain",
    buffer: Buffer.from(file.text),
  });
}

test("two workstations pair by saving and loading code files", async ({ browser }) => {
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await stubSavePicker(a!);
    await stubSavePicker(b!);
    await openApp(a!, "Front desk");
    await openApp(b!, "Back desk");
    await startSession(a!, "Outage", "Ann");

    await a!.getByRole("button", { name: "Add workstation" }).click();
    const join = await saved(a!);
    expect(join.name).toMatch(
      /^offline-checkout-join-Outage-Front-desk-\d{4}-\d\d-\d\d-\d{6}\.txt$/,
    );
    expect(join.text).toContain("Temporary file for pairing workstations");
    expect(join.text).toContain(await a!.getByLabel("Join code", { exact: true }).inputValue());

    await b!.getByRole("button", { name: "Join session" }).click();
    await load(b!, { name: "notes.txt", text: "nothing here" });
    await expect(b!.getByRole("alert")).toContainText("notes.txt has no pairing code in it");
    await load(b!, join);
    await b!.getByRole("button", { name: "Join", exact: true }).click();
    await b!.getByLabel("Clerk name").fill("Ben");
    await b!.getByRole("button", { name: "Continue" }).click();

    const reply = await saved(b!);
    expect(reply.name).toMatch(
      /^offline-checkout-reply-Outage-Back-desk-\d{4}-\d\d-\d\d-\d{6}\.txt$/,
    );
    await load(a!, reply);

    await expect(a!.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    await expect(b!.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("without Chrome's save dialog the code file is downloaded", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const a = await context.newPage();
    await a.addInitScript(() => delete (window as any).showSaveFilePicker);
    await openApp(a, "Front desk");
    await startSession(a, "Outage", "Ann");
    await a.getByRole("button", { name: "Add workstation" }).click();
    const code = a.getByLabel("Join code", { exact: true });
    await expect(code).not.toHaveValue("", { timeout: 15_000 });
    const [download] = await Promise.all([
      a.waitForEvent("download"),
      a.getByRole("button", { name: "Save to file" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^offline-checkout-join-Outage-Front-desk-/);
    expect(await readFile(await download.path(), "utf8")).toContain(await code.inputValue());
  } finally {
    await context.close();
  }
});
