import { expect, test } from "@playwright/test";
import { openApp, startSession } from "./helpers/app";

const theme = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);

test("the theme starts on Light, switches and is remembered", async ({ page }) => {
  await openApp(page);
  const button = page.getByRole("button", { name: "Theme: Light" });
  await expect(button).toBeVisible();
  expect(await theme(page)).toBe("light");
  const lightBackground = await page
    .locator("#app > div")
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  await button.click();
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();
  expect(await theme(page)).toBe("dark");
  await expect(page.locator("#app > div")).not.toHaveCSS("background-color", lightBackground);

  await page.reload();
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();
  expect(await theme(page)).toBe("dark");
});

test("a scan after changing the theme mid-patron still lands in the scan field", async ({
  page,
}) => {
  await openApp(page);
  await startSession(page, "Outage", "Ann");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.keyboard.type("P1001\n");

  await page.getByRole("button", { name: "Theme: Light" }).click();
  await page.keyboard.type("I2001\n");

  await expect(page.getByTestId("item")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Theme: Dark" })).toBeVisible();
  await expect(page.getByTestId("scan-input")).toBeFocused();
});

test("in the dark theme the QR code stays white and printing stays black on white", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await openApp(page);
  await page.getByRole("button", { name: "Theme: Light" }).click();
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
  await page.getByRole("button", { name: "Theme: Light" }).click();
  for (const label of ["Shelf light", "Shelf dark"]) {
    await page.getByRole("button", { name: /^Theme: / }).click();
    await expect(page.getByRole("button", { name: `Theme: ${label}` })).toBeVisible();
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
