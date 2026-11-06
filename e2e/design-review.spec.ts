import { expect, test, type Locator, type Page } from "@playwright/test";
import { appUrl, openApp, startSession } from "./helpers/app";
import { pairViaPaste } from "./helpers/pair";
import { stubPrint } from "./helpers/print";

/** About what a maximised app window leaves on a 1366x768 screen. */
const WINDOW = { width: 1366, height: 690 };

async function scan(page: Page, ...codes: string[]): Promise<void> {
  for (const code of codes) await page.keyboard.type(`${code}\n`);
}

async function ready(page: Page): Promise<void> {
  await page.setViewportSize(WINDOW);
  await stubPrint(page);
  await openApp(page);
  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Not now" }).click();
}

async function closeSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("button", { name: "Yes, close session" }).click();
  await expect(page.getByText("Session closed", { exact: true })).toBeVisible();
}

test("the item just scanned is on screen, however long the patron", async ({ page }) => {
  await ready(page);
  const items = Array.from({ length: 25 }, (_, i) => `I${1000 + i}`);
  await scan(page, "P1", ...items);
  await expect(page.getByTestId("item")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Void I1024" })).toBeInViewport();
  await expect(page.getByTestId("item").first()).toContainText("I1024");
});

test("Void patron asks first when the patron has items", async ({ page }) => {
  await ready(page);
  await scan(page, "P1", "I1", "I2", "I3");
  await expect(page.getByTestId("item")).toHaveCount(3);
  await page.getByRole("button", { name: "Void I2" }).click();

  await page.getByRole("button", { name: "Void patron" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("P1");
  await expect(dialog).toContainText("2 items");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 2");
  await scan(page, "I4");
  await expect(page.getByTestId("item")).toHaveCount(4);

  await page.getByRole("button", { name: "Void patron" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 1 · Items 3");

  await page.getByRole("button", { name: "Void patron" }).click();
  await dialog.getByRole("button", { name: "Yes, void patron" }).click();
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await expect(page.getByTestId("totals")).toHaveText("Patrons 0 · Items 0");
});

test("Void patron does not ask for a patron with no items", async ({ page }) => {
  await ready(page);
  await scan(page, "P1");
  await page.getByRole("button", { name: "Void patron" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Scan patron card")).toBeVisible();
});

test("a closed session does not ask for a patron card", async ({ page }) => {
  await ready(page);
  await closeSession(page);
  await page.getByRole("button", { name: "Back to scanning" }).click();
  await expect(page.getByText("Scanning has stopped")).toBeVisible();
  await expect(page.getByText("Scan patron card")).toHaveCount(0);
});

test("the scanner input stays put as patrons start and end", async ({ page }) => {
  await ready(page);
  const input = page.getByLabel("Scanner input");
  const before = (await input.boundingBox())!.y;
  await scan(page, "P1");
  await expect(page.getByTestId("finish-patron")).toBeVisible();
  expect((await input.boundingBox())!.y).toBe(before);
  await scan(page, "OC-END");
  await expect(page.getByTestId("finish-patron")).toHaveCount(0);
  expect((await input.boundingBox())!.y).toBe(before);
});

test("the small and selected button styles apply", async ({ page }) => {
  await page.setViewportSize(WINDOW);
  await stubPrint(page);
  await openApp(page);
  const rename = page.getByRole("button", { name: "Rename" });
  await expect(rename).toHaveCSS("min-height", "44px");
  await expect(rename).toHaveCSS("font-size", "18px");

  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Exit session" }).click();
  const white = "rgb(255, 255, 255)";
  const row = page.getByTestId("resume-list").getByRole("button", { name: /Outage/ });
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(row).not.toHaveCSS("background-color", white);

  const toggle = page.getByRole("button", { name: "Start new session" });
  await expect(toggle).toHaveCSS("background-color", white);
  await toggle.click();
  await expect(toggle).not.toHaveCSS("background-color", white);
});

test("the slide handle and its arrow are centred in the track", async ({ page }) => {
  await ready(page);
  await closeSession(page);
  await page.getByRole("button", { name: "Delete session" }).click();
  const handle = page.getByRole("alertdialog").getByRole("slider");
  const m = await handle.evaluate((el) => {
    const track = el.parentElement!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const arrow = el.querySelector("svg")!.getBoundingClientRect();
    const centre = (r: DOMRect) => r.top + r.height / 2;
    return {
      arrowOffset: centre(arrow) - centre(track),
      arrowOffsetX: arrow.left + arrow.width / 2 - (box.left + box.width / 2),
      handleOffset: centre(box) - centre(track),
      overhang: box.bottom - track.bottom,
    };
  });
  expect(m.arrowOffset).toBe(0);
  expect(m.arrowOffsetX).toBe(0);
  expect(m.handleOffset).toBe(0);
  expect(m.overhang).toBeLessThan(0);
});

/** The dialog stays inside the window, and scrolling it reaches every control. */
async function expectReachable(page: Page, dialog: Locator, height: number): Promise<void> {
  await page.setViewportSize({ width: 1366, height });
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  for (const control of await dialog.locator("button, input, [role=slider]").all()) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
  }
}

test("a tall dialog keeps its title and controls on screen and scrolls its text", async ({
  page,
}) => {
  await ready(page);
  await closeSession(page);
  await page.getByRole("button", { name: "Delete session" }).click();
  const dialog = page.getByRole("alertdialog");
  await page.setViewportSize({ width: 1366, height: 420 });

  const title = dialog.getByRole("heading", { name: "Delete session" });
  const slider = dialog.getByRole("slider");
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  for (const part of [title, slider, cancel]) {
    await expect(part).toBeInViewport({ ratio: 1 });
  }

  const text = dialog.locator("#confirm-text");
  const sizes = await text.evaluate((el) => ({ all: el.scrollHeight, shown: el.clientHeight }));
  expect(sizes.all).toBeGreaterThan(sizes.shown);
  const warning = dialog.getByText("Download the Evergreen file first");
  await warning.scrollIntoViewIfNeeded();
  await expect(warning).toBeInViewport({ ratio: 1 });
  for (const part of [title, slider, cancel]) {
    await expect(part).toBeInViewport({ ratio: 1 });
  }

  // A keyboard can scroll it too, without leaving the dialog.
  await cancel.focus();
  await page.keyboard.press("Tab");
  await expect(text).toBeFocused();
});

test("every dialog can be scrolled to all its controls in a very short window", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: WINDOW })));
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    await ready(a!);
    await stubPrint(b!);
    await openApp(b!, "Desk 2");
    await pairViaPaste(a!, b!, "Ben");

    await scan(a!, "P1", "I1");
    await a!.getByRole("button", { name: "Void patron" }).click();
    await expectReachable(a!, a!.getByRole("alertdialog"), 240);
    await a!.setViewportSize(WINDOW);
    await a!.keyboard.press("Escape");
    await scan(a!, "OC-END");

    await a!.getByRole("button", { name: "Change clerk" }).click();
    await expectReachable(a!, a!.getByRole("dialog"), 240);
    await a!.setViewportSize(WINDOW);
    await a!.keyboard.press("Escape");

    await a!.getByRole("button", { name: "Exit session" }).click();
    await expectReachable(a!, a!.getByRole("alertdialog"), 240);
    await a!.setViewportSize(WINDOW);
    await a!.keyboard.press("Escape");

    await a!.getByRole("button", { name: "Summary" }).click();
    await a!.getByRole("button", { name: "Close session" }).click();
    await expectReachable(a!, a!.getByRole("alertdialog"), 240);
    await a!.setViewportSize(WINDOW);
    await a!.keyboard.press("Escape");
    await expect(a!.getByRole("alertdialog")).toHaveCount(0);

    await a!.getByRole("button", { name: "Close session" }).click();
    await a!.getByRole("button", { name: "Yes, close session" }).click();
    await a!.getByRole("button", { name: "Delete session" }).click();
    await expectReachable(a!, a!.getByRole("alertdialog"), 240);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test.describe("pairing", () => {
  test("every pairing control fits a maximised window", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: WINDOW })));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await ready(a!);
      await stubPrint(b!);
      await openApp(b!, "Desk 2");

      await a!.getByRole("button", { name: "Add workstation" }).click();
      await expect(a!.getByLabel("Join code", { exact: true })).not.toHaveValue("", {
        timeout: 15_000,
      });
      for (const name of ["Copy", "Print code", "Save to file", "Load code from file"]) {
        await expect(a!.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
      }
      await expect(a!.getByTestId("countdown")).toBeInViewport();
      expect(await a!.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        WINDOW.height,
      );

      await b!.getByRole("button", { name: "Join session" }).click();
      await expect(b!.getByRole("button", { name: "Load code from file" })).toBeInViewport({
        ratio: 1,
      });
      expect(await b!.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        WINDOW.height,
      );
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("the connected message goes away, leaving the status dot", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await stubPrint(a!);
      await stubPrint(b!);
      await openApp(a!, "Desk 1");
      await openApp(b!, "Desk 2");
      await startSession(a!, "Outage", "Ann");
      await pairViaPaste(a!, b!, "Ben");

      const banner = a!.getByTestId("message");
      await expect(banner).toHaveText("Connected to Ben");
      await expect(banner).toHaveCount(0, { timeout: 12_000 });
      await expect(a!.getByRole("list", { name: "Workstations" })).toContainText("Ben");
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("a newer message is not cleared by the connected message's timer", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await stubPrint(a!);
      await stubPrint(b!);
      await openApp(a!, "Desk 1");
      await openApp(b!, "Desk 2");
      await startSession(a!, "Outage", "Ann");
      await pairViaPaste(a!, b!, "Ben");

      await scan(a!, "OC-END");
      const banner = a!.getByTestId("message");
      await expect(banner).toHaveText("No patron in progress");
      await a!.waitForTimeout(9_000);
      await expect(banner).toHaveText("No patron in progress");
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});

/** The field shows the error's colour, holds focus and names the error for screen readers. */
async function expectFieldError(field: Locator): Promise<void> {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const colours = await field.evaluate((el) => {
    const error = document.getElementById(el.getAttribute("aria-describedby")!)!;
    return { border: getComputedStyle(el).borderTopColor, error: getComputedStyle(error).color };
  });
  expect(colours.border).toBe(colours.error);
}

test.describe("form errors", () => {
  test("a missing name marks the field and moves focus to it", async ({ page }) => {
    await page.setViewportSize(WINDOW);
    await stubPrint(page);
    await page.goto(appUrl());
    const naming = page.getByTestId("workstation-form");
    await naming.getByRole("button", { name: "Save" }).click();
    await expectFieldError(naming.getByLabel("Workstation name"));
    await naming.getByLabel("Workstation name").fill("Desk 1");
    await naming.getByRole("button", { name: "Save" }).click();

    const start = page.getByTestId("start-form");
    await start.getByRole("button", { name: "Start session" }).click();
    await expectFieldError(start.getByLabel("Clerk name"));
    await start.getByLabel("Clerk name").fill("Ann");
    await start.getByRole("button", { name: "Start session" }).click();
    await page.getByRole("button", { name: "Not now" }).click();

    await page.getByRole("button", { name: "Change clerk" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Change clerk" }).click();
    await expectFieldError(dialog.getByLabel("Clerk name"));
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Exit session" }).click();
    const resume = page.getByTestId("resume-form");
    await resume.getByRole("button", { name: "Resume session" }).click();
    await expectFieldError(resume.getByLabel("Clerk name"));
  });

  test("joining focuses the clerk field and marks it when empty", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await stubPrint(a!);
      await stubPrint(b!);
      await openApp(a!, "Desk 1");
      await openApp(b!, "Desk 2");
      await startSession(a!, "Outage", "Ann");
      await a!.getByRole("button", { name: "Add workstation" }).click();
      const offer = a!.getByLabel("Join code", { exact: true });
      await expect(offer).not.toHaveValue("", { timeout: 15_000 });
      await b!.getByRole("button", { name: "Join session" }).click();
      await b!.getByLabel("Pasted code").fill(await offer.inputValue());
      await b!.getByRole("button", { name: "Use pasted code" }).click();
      await b!.getByRole("button", { name: "Join", exact: true }).click();
      const clerk = b!.getByLabel("Clerk name");
      await expect(clerk).toBeFocused();
      await b!.getByRole("button", { name: "Continue" }).click();
      await expectFieldError(clerk);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});

test.describe("start page", () => {
  test("the Join button lines up with Start session", async ({ page }) => {
    await page.setViewportSize(WINDOW);
    await stubPrint(page);
    await openApp(page);
    const start = await page.getByRole("button", { name: "Start session" }).boundingBox();
    const join = await page.getByRole("button", { name: "Join session" }).boundingBox();
    expect(join!.y + join!.height).toBe(start!.y + start!.height);
  });

  test("the start form opened by its button doesn't repeat the name", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "Exit session" }).click();
    await page.getByRole("button", { name: "Start new session" }).click();
    await expect(page.getByTestId("start-form")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start new session" })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Start new session" })).toBeVisible();
  });

  test("session times have no seconds", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "Exit session" }).click();
    await expect(page.getByTestId("resume-list")).not.toContainText(/\d:\d\d:\d\d/);
    await expect(page.getByTestId("resume-list")).toContainText(/\d:\d\d/);
  });
});

/** WCAG contrast of an element's text against white. */
async function contrastOnWhite(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = getComputedStyle(node).color;
    ctx.fillRect(0, 0, 1, 1);
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const l = 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    return 1.05 / (l + 0.05);
  });
}

test.describe("scan rows", () => {
  test("rows are compact and the same height, voided or not", async ({ page }) => {
    await ready(page);
    await scan(page, "P1", "I1", "I2", "I3");
    await expect(page.getByTestId("item")).toHaveCount(3);
    await page.getByRole("button", { name: "Void I2" }).click();
    await expect(page.getByText("voided")).toBeVisible();
    const heights = await page
      .getByTestId("item")
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeLessThanOrEqual(46);
  });

  test("row Void buttons are quiet beside Void patron", async ({ page }) => {
    await ready(page);
    await scan(page, "P1", "I1");
    const row = page.getByRole("button", { name: "Void I1" });
    const patron = page.getByRole("button", { name: "Void patron" });
    const colour = (el: Locator) => el.evaluate((n) => getComputedStyle(n).color);
    expect(await colour(row)).not.toBe(await colour(patron));
  });

  test("voided text is readable on both screens", async ({ page }) => {
    await ready(page);
    await scan(page, "P1", "I1", "I2");
    await page.getByRole("button", { name: "Void I2" }).click();
    const onScan = page.getByTestId("item").filter({ hasText: "voided" }).locator("span").first();
    await expect(onScan).toHaveClass(/line-through/);
    expect(await contrastOnWhite(onScan)).toBeGreaterThanOrEqual(4.5);
    await scan(page, "OC-END");
    await page.getByRole("button", { name: "Summary" }).click();
    const onSummary = page.getByTestId("summary-patron").locator(".line-through").first();
    expect(await contrastOnWhite(onSummary)).toBeGreaterThanOrEqual(4.5);
  });
});

test("every screen's content starts at the same left edge", async ({ page }) => {
  await ready(page);
  const left = async (el: Locator) => (await el.boundingBox())!.x;
  const onScan = await left(page.getByLabel("Scanner input"));
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByRole("heading", { name: "Session summary" }).waitFor();
  expect(await left(page.getByLabel("Scanner input"))).toBe(onScan);
  await page.getByRole("button", { name: "Add workstation" }).click();
  expect(await left(page.getByRole("heading", { name: "Add workstation" }))).toBe(onScan);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Exit session" }).click();
  expect(await left(page.getByTestId("workstation"))).toBe(onScan);
});

test.describe("status bar", () => {
  test("the current clerk is easy to read and Summary shows it is open", async ({ page }) => {
    await ready(page);
    await expect(page.getByTestId("clerk")).toHaveCSS("font-size", "18px");
    const summary = page.getByRole("button", { name: "Summary" });
    await expect(summary).not.toHaveAttribute("aria-current");
    await expect(summary).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await summary.click();
    await expect(summary).toHaveAttribute("aria-current", "page");
    await expect(summary).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("other desks show their workstation, and say in words when they drop", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await stubPrint(a!);
      await stubPrint(b!);
      await openApp(a!, "Desk 1");
      await openApp(b!, "Desk 2");
      await startSession(a!, "Outage", "Ann");
      await pairViaPaste(a!, b!, "Ben");
      await scan(b!, "P1", "OC-END");

      const desks = a!.getByRole("list", { name: "Workstations" });
      await expect(desks).toContainText("Ben (Desk 2)", { timeout: 10_000 });
      await expect(desks).not.toContainText("not connected");
      await b!.close();
      await expect(desks).toContainText("not connected", { timeout: 60_000 });
      await expect(desks.getByRole("img", { name: "disconnected" })).toBeVisible();
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});

test.describe("pairing screens", () => {
  test("the camera says what it is doing before there is a picture", async ({ page }) => {
    await ready(page);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
    await page.reload();
    await page.getByRole("button", { name: "Join session" }).first().click();
    await expect(page.getByTestId("camera-status")).toHaveText("Starting camera…");
    await expect(page.getByTestId("camera-status")).toBeVisible();
  });

  test("the camera says so when it can't start", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("denied"));
    });
    await page.setViewportSize(WINDOW);
    await openApp(page);
    await page.getByRole("button", { name: "Join session" }).click();
    await expect(page.getByTestId("camera-status")).toHaveText("No camera");
  });

  test("Use pasted code becomes the main action once there is a code", async ({ page }) => {
    await page.setViewportSize(WINDOW);
    await openApp(page);
    await page.getByRole("button", { name: "Join session" }).click();
    const use = page.getByRole("button", { name: "Use pasted code" });
    await expect(use).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.getByLabel("Pasted code").fill("OC3:something");
    await expect(use).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("the card keeps its width through every step of joining", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexts = await Promise.all([1, 2].map(() => browser.newContext({ viewport: WINDOW })));
    try {
      const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
      await ready(a!);
      await stubPrint(b!);
      await openApp(b!, "Desk 2");
      await a!.getByRole("button", { name: "Add workstation" }).click();
      const offer = a!.getByLabel("Join code", { exact: true });
      await expect(offer).not.toHaveValue("", { timeout: 15_000 });

      const card = b!.locator("main").locator("section, form").first();
      const width = async () => (await card.boundingBox())!.width;
      await b!.getByRole("button", { name: "Join session" }).click();
      await b!.getByLabel("Pasted code").waitFor();
      const first = await width();
      await b!.getByLabel("Pasted code").fill(await offer.inputValue());
      await b!.getByRole("button", { name: "Use pasted code" }).click();
      await b!.getByRole("button", { name: "Join", exact: true }).waitFor();
      expect(await width()).toBe(first);
      await b!.getByRole("button", { name: "Join", exact: true }).click();
      await b!.getByLabel("Clerk name").fill("Ben");
      expect(await width()).toBe(first);
      await b!.getByRole("button", { name: "Continue" }).click();
      await expect(b!.getByLabel("Reply code", { exact: true })).not.toHaveValue("", {
        timeout: 15_000,
      });
      expect(await width()).toBe(first);
      await expect(b!.getByRole("button", { name: "Save to file" })).toBeInViewport({ ratio: 1 });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
