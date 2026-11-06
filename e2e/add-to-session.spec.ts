import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openApp, startSession } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { stubPrint } from "./helpers/print";

const DOUBLE_UPLOAD =
  "If any of these checkouts are already in Evergreen, the new Evergreen file would check them out again.";
const NOTHING_NEW = "Nothing new to add. Everything here is already in this session.";

async function scan(page: Page, ...codes: string[]): Promise<void> {
  for (const code of codes) await page.keyboard.type(`${code}\n`);
}

/** With an open session on Launch, the start form sits behind a button. */
async function startAnother(page: Page, name: string, clerk: string): Promise<void> {
  await page.getByRole("button", { name: "Start new session" }).click();
  await startSession(page, name, clerk);
}

async function toSummary(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { name: "Session summary" })).toBeVisible();
}

async function closeSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("button", { name: "Yes, close session" }).click();
  await expect(page.getByText("Session closed", { exact: true })).toBeVisible();
}

/** Without a connected workstation, Exit session leaves with no confirmation. */
async function exitSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Exit session" }).click();
  const yes = page.getByRole("button", { name: "Yes, exit session" });
  const launch = page.getByRole("heading", { name: "Offline Checkout" });
  await expect(yes.or(launch)).toBeVisible();
  if (await yes.isVisible()) await yes.click();
  await expect(launch).toBeVisible();
}

async function save(page: Page, button: string, name: string): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button }).click(),
  ]);
  const path = test.info().outputPath(name);
  await file.saveAs(path);
  return path;
}

async function checkouts(path: string): Promise<Record<string, string>[]> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, string>);
}

const pairs = (xacts: Record<string, string>[]) =>
  xacts.map((x) => `${x.patron_barcode}/${x.barcode}`).sort();

function chooseSession(page: Page, name: string) {
  return page.getByTestId("other-sessions").getByRole("button", { name }).click();
}

async function confirmAdd(page: Page, clerk: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name").fill(clerk);
  await dialog.getByRole("button", { name: "Add to session" }).click();
  await expect(dialog).toBeHidden();
}

/** Friday with two patrons, exited, then a new session named `next`, on its scan screen. */
async function fridayThen(page: Page, next: string): Promise<void> {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Friday", "Ann");
  await scan(page, "P1", "I1", "OC-END", "P2", "I2", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await exitSession(page);
  await startAnother(page, next, "Bob");
}

test("Friday and Saturday combine into one Evergreen file", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Friday", "Ann");
  await scan(page, "P1", "I1", "OC-END", "P2", "I2", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await toSummary(page);
  const fridayFile = await save(page, "Download for Evergreen", "friday.xacts");
  await closeSession(page);
  await exitSession(page);

  await startSession(page, "Saturday", "Bob");
  await scan(page, "P1", "I1", "OC-END", "P3", "I3", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await toSummary(page);

  await chooseSession(page, "Friday");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Adds 1 patron and 1 item. 1 already here.");
  await expect(dialog).toContainText(DOUBLE_UPLOAD);
  await expect(dialog).toContainText(
    /Friday had an Evergreen download at .+ on .+ by Ann \(Desk 1\)\./,
  );
  await expect(dialog).not.toContainText("is still open");

  const name = dialog.getByLabel("Your name");
  const add = dialog.getByRole("button", { name: "Add to session" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await expect(add).toBeDisabled();
  await name.fill("   ");
  await expect(add).toBeDisabled();
  await name.fill("Cleo");
  await name.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await add.click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("totals")).toHaveText("Patrons 3 · Items 3");
  await expect(page.getByTestId("message")).toHaveText("Added 1 patron and 1 item.");
  const added = page.getByTestId("added-list");
  await expect(page.getByRole("heading", { name: "Added to this session" })).toBeVisible();
  await expect(added).toContainText(/Friday: 1 patron, 1 item, added .+ by Cleo \(Desk 1\)/);

  const saturdayFile = await save(page, "Download for Evergreen", "saturday.xacts");
  const combined = await checkouts(saturdayFile);
  expect(pairs(combined)).toEqual(["P1/I1", "P2/I2", "P3/I3"]);
  const friday = await checkouts(fridayFile);
  const p2 = (xacts: Record<string, string>[]) => xacts.find((x) => x.barcode === "I2")!;
  expect(p2(combined).checkout_time).toBe(p2(friday).checkout_time);

  await exitSession(page);
  await page
    .getByTestId("resume-list")
    .getByRole("button", { name: /Friday/ })
    .click();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await expect(page.getByTestId("added-list")).toBeHidden();
  await expect(page.getByText("Session closed", { exact: true })).toBeVisible();
});

test("adding into a closed session keeps it closed", async ({ page }) => {
  await fridayThen(page, "Saturday");
  await scan(page, "P3", "I3", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await toSummary(page);
  await closeSession(page);

  await chooseSession(page, "Friday");
  await expect(page.getByRole("dialog")).toContainText(
    "Friday is still open. Scans made there later need adding again.",
  );
  await confirmAdd(page, "Cleo");

  await expect(page.getByTestId("totals")).toHaveText("Patrons 3 · Items 3");
  await expect(page.getByText("Session closed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close session" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete session" })).toBeVisible();
});

test("a second add says nothing is new and offers only Close", async ({ page }) => {
  await fridayThen(page, "Saturday");
  await toSummary(page);
  await chooseSession(page, "Friday");
  await confirmAdd(page, "Cleo");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");

  await chooseSession(page, "Friday");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(NOTHING_NEW);
  await expect(dialog).not.toContainText(DOUBLE_UPLOAD);
  await expect(dialog.getByRole("button")).toHaveText(["Close"]);
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(dialog.getByLabel("Your name")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await expect(page.getByTestId("added-list").getByRole("listitem")).toHaveCount(1);
});

test("Excel, CSV and Evergreen files of one session add each checkout once", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Friday", "Ann");
  await scan(page, "P1", "I1", "OC-END", "P2", "I2", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
  await toSummary(page);
  const exported = [
    { name: "friday.csv", button: "Download CSV" },
    { name: "friday.xlsx", button: "Download Excel" },
    { name: "friday.xacts", button: "Download for Evergreen" },
  ];
  const files = [];
  for (const { name, button } of exported) {
    const buffer = await readFile(await save(page, button, name));
    files.push({ name, mimeType: "application/octet-stream", buffer });
  }
  await exitSession(page);

  await startAnother(page, "Saturday", "Bob");
  await scan(page, "P3", "I3", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await toSummary(page);

  const input = page.getByTestId("add-files");
  await input.setInputFiles([
    ...files,
    { name: "friday.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") },
    { name: "junk.txt", mimeType: "text/plain", buffer: Buffer.from("not ours\n") },
  ]);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("friday.csv: CSV file");
  await expect(dialog).toContainText("friday.xlsx: Excel file");
  await expect(dialog).toContainText("friday.xacts: Evergreen file");
  await expect(dialog).toContainText("friday.pdf");
  await expect(dialog).toContainText("A PDF can't be added");
  await expect(dialog).toContainText("junk.txt");
  await expect(dialog).toContainText("This isn't a file exported by Offline Checkout.");
  await expect(dialog).toContainText("The other files can still be added.");
  await expect(input).toHaveValue("");
  await confirmAdd(page, "Cleo");

  await expect(page.getByTestId("totals")).toHaveText("Patrons 3 · Items 3");
  await expect(page.getByTestId("per-clerk")).not.toContainText("Imported");
  const combined = await checkouts(await save(page, "Download for Evergreen", "combined.xacts"));
  expect(pairs(combined)).toEqual(["P1/I1", "P2/I2", "P3/I3"]);
});

test("the same file can be chosen again, and all-rejected offers only Close", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Saturday", "Bob");
  await toSummary(page);
  await expect(page.getByTestId("other-sessions")).toContainText("No other sessions");

  const pdf = {
    name: "friday.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n"),
  };
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("add-files").setInputFiles(pdf);
    await expect(dialog).toContainText("A PDF can't be added");
    await expect(dialog).not.toContainText("The other files can still be added.");
    await expect(dialog).not.toContainText(DOUBLE_UPLOAD);
    await expect(dialog.getByRole("button")).toHaveText(["Close"]);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  }
});

test("files dropped on the zone open the preview", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Friday", "Ann");
  await scan(page, "P1", "I1", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await toSummary(page);
  const text = await readFile(await save(page, "Download for Evergreen", "friday.xacts"), "utf8");
  await exitSession(page);
  await startAnother(page, "Saturday", "Bob");
  await toSummary(page);

  const dataTransfer = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], "friday.xacts"));
    return dt;
  }, text);
  const zone = page.getByTestId("add-drop-zone");
  await zone.dispatchEvent("dragover", { dataTransfer });
  await zone.dispatchEvent("drop", { dataTransfer });

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("friday.xacts: Evergreen file");
  await expect(dialog).toContainText(
    "An Evergreen file has no clerk or workstation, so its items count under Imported.",
  );
  await confirmAdd(page, "Cleo");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await expect(page.getByTestId("per-clerk")).toContainText("Imported");
  await expect(page.getByTestId("added-list")).toContainText(
    /friday\.xacts: 1 patron, 1 item, added .+ by Cleo \(Desk 1\)/,
  );
});

test("a file dropped outside the zone is blocked", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Saturday", "Bob");
  await toSummary(page);
  const url = page.url();

  const blocked = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "friday.xacts"));
    return ["dragover", "drop"].map(
      (type) =>
        !document.body.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        ),
    );
  });
  expect(blocked).toEqual([true, true]);
  expect(page.url()).toBe(url);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a scan while the preview is open isn't recorded, and Escape closes it", async ({ page }) => {
  await fridayThen(page, "Saturday");
  await scan(page, "P3", "I3", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await toSummary(page);
  await chooseSession(page, "Friday");
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("Your name");
  await expect(name).toBeFocused();

  // A scan into the name field stays there; its Enter does nothing.
  await scan(page, "P8");
  await expect(name).toHaveValue("P8");
  // With focus off the field, a scan is dropped, and Tab and Escape still work.
  await dialog.getByRole("heading", { name: "Add to this session" }).click();
  await scan(page, "P9", "I9");
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("P8");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await page.keyboard.press("Tab");
  await expect(name).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("heading", { name: "Add to this session" }).click();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await expect(page.getByTestId("scan-input")).toBeFocused();
  await expect(page.getByTestId("scan-input")).toHaveValue("");

  await chooseSession(page, "Friday");
  await expect(name).toHaveValue("");
  await expect(name).toBeFocused();
});

test("a slow click on a session below the fold lands, and the result shows at the top", async ({
  page,
}) => {
  await fridayThen(page, "Saturday");
  await toSummary(page);
  const row = page.getByTestId("other-sessions").getByRole("button", { name: "Friday" });
  const dialog = page.getByRole("dialog");

  // The scanner input takes focus back between the press and the release.
  await row.click({ delay: 200 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("scan-input")).toBeFocused();
  await expect(row).toBeInViewport();

  await row.click({ delay: 200 });
  await confirmAdd(page, "Cleo");
  await expect(page.getByTestId("message")).toHaveText("Added 2 patrons and 2 items.");
  await expect(page.getByTestId("message")).toBeInViewport();
});

/** Scroll so `name` sits at the top of the window, with the banners' place above it off screen. */
async function scrollToButton(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name }).evaluate((el) => {
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 10);
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
}

test("an export failure on a scrolled Summary shows its banner, every time", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Saturday", "Bob");
  await scan(page, "P1", "I1", "OC-END");
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
  await toSummary(page);
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("no memory");
    };
  });

  const banner = page.getByTestId("message");
  for (let i = 0; i < 2; i++) {
    await scrollToButton(page, "Download for Evergreen");
    await page.getByRole("button", { name: "Download for Evergreen" }).click();
    await expect(banner).toHaveText("Could not create the Evergreen file");
    await expect(banner).toBeInViewport();
  }
});

test("closing a scrolled Summary shows the Session closed banner", async ({ page }) => {
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Saturday", "Bob");
  await toSummary(page);
  await scrollToButton(page, "Close session");
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("button", { name: "Yes, close session" }).click();
  await expect(page.getByText("Session closed", { exact: true })).toBeInViewport();
});

test("a message on a scrolled scan screen comes into view", async ({ page }) => {
  await stubPrint(page);
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await startSession(page, "Saturday", "Bob");
  await scan(page, "P1", ...Array.from({ length: 12 }, (_, i) => `I${i + 1}`));
  await expect(page.getByTestId("item")).toHaveCount(12);

  // Only the scan's Enter is left to arrive, so typing doesn't scroll the input back into view.
  await page.keyboard.type("I1");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.keyboard.press("Enter");

  const banner = page.getByTestId("message");
  await expect(banner).toHaveText("Already on this patron — not added");
  await expect(banner).toBeInViewport();
});

test("a session that can't be read gives an error and opens no preview", async ({ page }) => {
  await fridayThen(page, "Saturday");
  await toSummary(page);
  const row = page.getByTestId("other-sessions").getByRole("button", { name: "Friday" });
  await expect(row).toBeVisible();

  // Friday goes from the index behind the list's back, as if deleted in another tab.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("offline-checkout");
      open.onerror = () => reject(new Error("open failed"));
      open.onsuccess = () => {
        const db = open.result;
        const store = db.transaction("sessions", "readwrite").objectStore("sessions");
        const all = store.getAll();
        all.onsuccess = () => {
          const friday = (all.result as { sessionId: string; name: string }[]).find(
            (s) => s.name === "Friday",
          )!;
          store.delete(friday.sessionId).onsuccess = () => {
            db.close();
            resolve();
          };
        };
      };
    });
  });

  await row.click();
  await expect(page.getByTestId("message")).toContainText("Could not read that session");
  await expect(page.getByTestId("message")).toBeInViewport();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("other-sessions")).toContainText("No other sessions");
});

test("a failed save closes the preview and shows the error", async ({ page }) => {
  await fridayThen(page, "Saturday");
  await toSummary(page);
  await chooseSession(page, "Friday");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name").fill("Cleo");
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => {
      throw new Error("disk full");
    };
  });
  await dialog.getByRole("button", { name: "Add to session" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("message")).toContainText(
    "Could not add to this session, so nothing was changed.",
  );
  await expect(page.getByTestId("message")).toBeInViewport();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 0 · Items 0");
});

test("two paired workstations both get an import, with no Not connected entry", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await stubPrint(a!);
    await stubPrint(b!);
    await openApp(a!, "Front desk");
    await openApp(b!, "Back desk");

    await startSession(a!, "Friday", "Ann");
    await scan(a!, "P1", "I1", "OC-END", "P2", "I2", "OC-END");
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 2 · Items 2");
    await toSummary(a!);
    const file = await save(a!, "Download Excel", "friday.xlsx");
    await exitSession(a!);

    await startAnother(a!, "Saturday", "Ann");
    await pairViaPaste(a!, b!, "Ben");
    await scan(a!, "P3", "I3", "OC-END");
    await expect(b!.getByTestId("totals")).toHaveText("Patrons 1 · Items 1", { timeout: 15_000 });

    await toSummary(a!);
    await toSummary(b!);
    await a!.getByTestId("add-files").setInputFiles(file);
    await confirmAdd(a!, "Cleo");

    await expect(a!.getByTestId("totals")).toHaveText("Patrons 3 · Items 3");
    await expect(b!.getByTestId("totals")).toHaveText("Patrons 3 · Items 3", { timeout: 15_000 });
    await expect(b!.getByTestId("added-list")).toContainText("friday.xlsx: 2 patrons, 2 items");

    for (const page of [a!, b!]) {
      await expect(page.getByTestId("not-connected")).toHaveCount(0);
      await expect(page.getByText("Unnamed")).toHaveCount(0);
    }
    for (const id of ["per-clerk", "per-workstation", "summary-patrons", "added-list"]) {
      await expect(b!.getByTestId(id)).toHaveText((await a!.getByTestId(id).textContent())!);
    }
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("an open preview follows the log to nothing new when a peer adds the same file", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  try {
    const [a, b] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await stubPrint(a!);
    await stubPrint(b!);
    await openApp(a!, "Front desk");
    await openApp(b!, "Back desk");

    await startSession(a!, "Friday", "Ann");
    await scan(a!, "P1", "I1", "OC-END");
    await expect(a!.getByTestId("totals")).toHaveText("Patrons 1 · Items 1");
    await toSummary(a!);
    const file = await save(a!, "Download Excel", "friday.xlsx");
    await exitSession(a!);

    await startAnother(a!, "Saturday", "Ann");
    await pairViaPaste(a!, b!, "Ben");
    await toSummary(a!);
    await toSummary(b!);

    await a!.getByTestId("add-files").setInputFiles(file);
    const preview = a!.getByRole("dialog");
    await expect(preview).toContainText("Adds 1 patron and 1 item.");
    await b!.getByTestId("add-files").setInputFiles(file);
    await confirmAdd(b!, "Ben");

    await expect(preview).toContainText(NOTHING_NEW, { timeout: 15_000 });
    await expect(preview.getByRole("button")).toHaveText(["Close"]);
    await expect(preview.getByRole("button", { name: "Close" })).toBeFocused();
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
