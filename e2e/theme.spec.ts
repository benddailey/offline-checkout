import { expect, test } from "@playwright/test";
import { openApp, startSession } from "./helpers/app";

type Page = import("@playwright/test").Page;

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

async function chooseTheme(page: Page, label: string) {
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const menu = page.getByRole("group", { name: "Theme" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: label, exact: true }).click();
  await expect(menu).toBeHidden();
}

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
  await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a scan after changing the theme mid-patron still lands in the scan field", async ({
  page,
}) => {
  await openApp(page);
  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.keyboard.type("P1001\n");

  await chooseTheme(page, "Shelf dark");
  await page.keyboard.type("I2001\n");

  await expect(page.getByTestId("item")).toHaveCount(1);
  expect(await theme(page)).toBe("shelf-dark");
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

test("the shelf themes draw a bookshelf behind a solid panel without scrolling", async ({
  page,
}) => {
  await openApp(page);
  for (const id of ["Shelf light", "Shelf dark"]) {
    await chooseTheme(page, id);
    await expect(page.locator("#app > div")).toHaveCSS(
      "background-image",
      /^url\("data:image\/svg/,
    );
    expect(
      await page.evaluate(() => {
        const d = document.documentElement;
        return d.scrollHeight - d.clientHeight;
      }),
    ).toBe(0);
  }
});

test("in a shelf theme the panel drags by its background, stays in the window and is remembered", async ({
  page,
}) => {
  await openApp(page);
  await chooseTheme(page, "Shelf dark");
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
  expect(
    await page.evaluate(() => {
      const d = document.documentElement;
      return [d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight];
    }),
  ).toEqual([0, 0]);

  await page.reload();
  expect((await panel.boundingBox())!.x).toBe(0);

  await page.mouse.dblclick(8, (await panel.boundingBox())!.y + 8);
  expect((await panel.boundingBox())!.x).toBe(before.x);

  await chooseTheme(page, "Light");
  await page.mouse.move(before.x + 40, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x - 60, before.y + 48, { steps: 5 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.x).toBe(before.x);
});
