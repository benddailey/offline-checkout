import { expect, test } from "@playwright/test";
import { openApp, startSession } from "./helpers/app";
import { servePhotos } from "./helpers/photos";

type Page = import("@playwright/test").Page;

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

/** Opens the Theme menu, picks `label` under `heading`, and closes the menu with Esc. */
async function choose(page: Page, heading: "Theme" | "Background", label: string) {
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const group = page.getByRole("group", { name: heading });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: label, exact: true }).click();
  await expect(group.getByRole("button", { name: label, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(group).toBeHidden();
}

const chooseTheme = (page: Page, label: string) => choose(page, "Theme", label);
const chooseBackground = (page: Page, label: string) => choose(page, "Background", label);

const overflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return [d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight];
  });

test("the theme starts on Light, switches and is remembered", async ({ page }) => {
  await openApp(page);
  expect(await theme(page)).toBe("light");
  const lightBackground = await page
    .locator("#app > div")
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  await chooseTheme(page, "Dark");
  expect(await theme(page)).toBe("dark");
  await expect(page.locator("#app > div")).not.toHaveCSS("background-color", lightBackground);

  await page.reload();
  expect(await theme(page)).toBe("dark");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a scan after changing the theme mid-patron still lands in the scan field", async ({
  page,
}) => {
  await openApp(page);
  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.keyboard.type("P1001\n");

  await chooseTheme(page, "Dark");
  await chooseBackground(page, "Evergreen shelves");
  await page.keyboard.type("I2001\n");

  await expect(page.getByTestId("item")).toHaveCount(1);
  expect(await theme(page)).toBe("dark");
  await expect(page.getByTestId("scan-input")).toBeFocused();
});

test("in the dark theme the QR code stays white and printing stays black on white", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await openApp(page);
  await chooseTheme(page, "Dark");
  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Add workstation" }).click();

  const qr = page.getByRole("img", { name: /QR code/ });
  await expect(qr).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.getByRole("button", { name: "Print code" }).click();
  await page.emulateMedia({ media: "print" });
  const root = page.locator("#oc-print-root");
  await expect(root).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("backgrounds are chosen apart from the theme and never add scroll bars", async ({ page }) => {
  await openApp(page);
  const root = page.locator("#app > div");
  const image = () => root.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await image()).toBe("none");

  await chooseBackground(page, "Evergreen shelves");
  const lightShelves = await image();
  expect(lightShelves).toMatch(/^url\("data:image\/svg/);
  await chooseTheme(page, "Dark");
  expect(await image()).toMatch(/^url\("data:image\/svg/);
  expect(await image()).not.toBe(lightShelves);
  expect(await overflow(page)).toEqual([0, 0]);

  await page.reload();
  expect(await theme(page)).toBe("dark");
  expect(await image()).toMatch(/^url\("data:image\/svg/);
});

test("with a background the panel drags by its own background, stays in the window and is remembered", async ({
  page,
}) => {
  await openApp(page);
  await chooseBackground(page, "Evergreen shelves");
  const panel = page.locator("main");
  const before = (await panel.boundingBox())!;
  // The Launch screen has no status bar, so the gap is from the top of the window.
  expect(before.y).toBe(12);

  // Its top padding is background, so it drags; text and controls inside don't.
  await page.mouse.move(before.x + 40, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x - 60, before.y + 28, { steps: 5 });
  await page.mouse.up();
  let after = (await panel.boundingBox())!;
  expect(after.x).toBe(before.x - 100);
  expect(after.y).toBe(before.y + 20);

  // Dragged far past the window's corner, it stops at the edge without scroll bars.
  await page.mouse.move(after.x + 40, after.y + 8);
  await page.mouse.down();
  await page.mouse.move(after.x - 2000, after.y + 2000, { steps: 5 });
  await page.mouse.up();
  after = (await panel.boundingBox())!;
  expect(after.x).toBe(0);
  expect(await overflow(page)).toEqual([0, 0]);

  await page.reload();
  expect((await panel.boundingBox())!.x).toBe(0);

  await page.mouse.dblclick(8, (await panel.boundingBox())!.y + 8);
  expect((await panel.boundingBox())!.x).toBe(before.x);

  await chooseBackground(page, "None");
  await page.mouse.move(before.x + 40, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x - 60, before.y + 48, { steps: 5 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.x).toBe(before.x);
});

const menuButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "Background" }).getByRole("button", { name: label, exact: true });

test("offline with nothing downloaded, only None and Evergreen shelves are offered", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("oc-background", "longroom"));
  await openApp(page);
  // A chosen photo that isn't on this PC shows as None until it is.
  expect(await page.evaluate(() => document.documentElement.dataset.background)).toBe("none");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(page.getByRole("group", { name: "Background" }).getByRole("button")).toHaveText([
    "None",
    "Evergreen shelves",
  ]);
  await expect(page.getByTestId("photos-missing")).toHaveText(
    "12 more photos download when this PC is online.",
  );
});

test("photos download once, are checked, kept in their own bucket and shown offline", async ({
  page,
}) => {
  await servePhotos(page, ["admont"]);
  await page.addInitScript(
    () =>
      localStorage.getItem("oc-background") ?? localStorage.setItem("oc-background", "longroom"),
  );
  await openApp(page);
  const root = page.locator("#app > div");
  // The saved choice appears by itself once its photo arrives.
  await expect(root).toHaveCSS("background-image", /^linear-gradient\(.*url\("blob:/);

  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await expect(menuButton(page, "Tianjin Binhai")).toBeVisible();
  // Admont's bytes didn't match its hash, so it was not kept.
  await expect(menuButton(page, "Admont Abbey")).toHaveCount(0);
  await expect(page.getByTestId("photos-missing")).toHaveText(
    "1 more photo downloads when this PC is online.",
  );
  await expect(page.getByTestId("background-credit")).toContainText("Photo: Diliff, CC BY-SA 4.0");
  await menuButton(page, "Library of Congress").click();
  await expect(page.getByTestId("background-credit")).toContainText("Carol M. Highsmith");

  const stores = await page.evaluate(async () => ({
    buckets: await (
      navigator as Navigator & { storageBuckets: { keys(): Promise<string[]> } }
    ).storageBuckets.keys(),
    defaults: (await indexedDB.databases()).map((d) => d.name),
  }));
  expect(stores.buckets).toContain("backgrounds");
  expect(stores.defaults).not.toContain("offline-checkout-backgrounds");

  await page.unrouteAll();
  await page.reload();
  await expect(root).toHaveCSS("background-image", /^linear-gradient\(.*url\("blob:/);
  expect(await page.evaluate(() => document.documentElement.dataset.background)).toBe("loc");
});
