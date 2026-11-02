import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

/** Set HEADED=1 to watch the browsers. */
export const HEADLESS = !process.env.HEADED;

export const CHROMIUM_ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

export function appUrl(): string {
  return pathToFileURL(resolve(process.cwd(), "dist", "offline-checkout.html")).href;
}

export function launchChromium(extraArgs: string[] = []): Promise<Browser> {
  return chromium.launch({ headless: HEADLESS, args: [...CHROMIUM_ARGS, ...extraArgs] });
}

/** On Launch, open a session that has not been closed as `clerk`. */
export async function resumeAs(page: Page, session: string | RegExp, clerk: string): Promise<void> {
  const row = page.getByTestId("resume-list").getByRole("button", { name: session });
  // The most recent open session starts expanded; clicking it would collapse it.
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  const form = page.getByTestId("resume-form");
  await form.getByLabel("Clerk name").fill(clerk);
  await form.getByRole("button", { name: "Resume session" }).click();
}

/** On Launch, start a new session as `clerk` and wait for the scan screen. */
export async function startSession(page: Page, session: string, clerk: string): Promise<void> {
  const form = page.getByTestId("start-form");
  await form.getByLabel("Session name").fill(session);
  await form.getByLabel("Clerk name").fill(clerk);
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeVisible();
}

/** Open the app; on a workstation with no name yet, name it `workstation` first. */
export async function openApp(page: Page, workstation = "Desk 1"): Promise<void> {
  await page.goto(appUrl());
  const form = page.getByTestId("workstation-form");
  const named = page.getByTestId("workstation");
  await expect(form.or(named)).toBeVisible();
  if (await named.isVisible()) return;
  await form.getByLabel("Workstation name").fill(workstation);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(named).toBeVisible();
}
