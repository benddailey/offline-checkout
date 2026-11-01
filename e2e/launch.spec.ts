import { expect, test, type Page } from "@playwright/test";
import { appUrl, openApp } from "./helpers/app";
import { stubPrint } from "./helpers/print";

async function startSession(page: Page, name: string, clerk: string): Promise<void> {
  const form = page.getByTestId("start-form");
  await form.getByLabel("Session name").fill(name);
  await form.getByLabel("Clerk name").fill(clerk);
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Scanner input")).toBeVisible();
}

async function exitSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Exit session" }).click();
  await expect(page.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
}

test("the start page leads with the latest open session unless it has been idle for 72 hours", async ({
  page,
}) => {
  await stubPrint(page);
  await openApp(page);
  const startForm = page.getByTestId("start-form");
  const resumeForm = page.getByTestId("resume-form");
  const startToggle = page.getByRole("button", { name: "Start new session" });

  // Only a closed session: the page is laid out as before.
  await startSession(page, "Friday", "Ann");
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("button", { name: "Yes, close session" }).click();
  await exitSession(page);
  await expect(startForm).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume" })).toBeVisible();
  await expect(page.getByTestId("session-closed")).toHaveText("Closed");
  await expect(resumeForm).toBeHidden();
  await expect(startToggle).toHaveCount(0);

  // An open session: it comes first, expanded, with its clerk field focused.
  await startSession(page, "Saturday", "Rae");
  await page.keyboard.type("P1\nI1\nOC-END\n");
  await expect(page.getByText("Scan patron card")).toBeVisible();
  await exitSession(page);
  const open = page.getByRole("region", { name: "Open sessions" });
  const closed = page.getByRole("region", { name: "Closed sessions" });
  await expect(open.getByRole("button", { name: /Saturday/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(resumeForm.getByLabel("Clerk name")).toBeFocused();
  await expect(resumeForm.getByLabel("Clerk name")).toHaveValue("");
  await expect(closed).toContainText("Friday");
  await expect(page.getByTestId("session-closed")).toHaveCount(0);
  await expect(startForm).toBeHidden();
  await expect(page.getByRole("button", { name: "Join session" })).toBeVisible();

  // Only one clerk field at a time.
  await startToggle.click();
  await expect(startForm).toBeVisible();
  await expect(startForm.getByLabel("Clerk name")).toBeFocused();
  await expect(resumeForm).toBeHidden();
  await open.getByRole("button", { name: /Saturday/ }).click();
  await expect(resumeForm).toBeVisible();
  await expect(startForm).toBeHidden();

  // A newer session takes the top spot.
  await startToggle.click();
  await startSession(page, "Sunday", "Sam");
  await exitSession(page);
  await expect(open.getByRole("listitem").first()).toContainText("Sunday");
  await expect(open.getByRole("button", { name: /Sunday/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // 72 hours later with nothing recorded, the page is laid out as before.
  await page.clock.setFixedTime(Date.now() + 73 * 60 * 60 * 1000);
  await page.reload();
  await expect(startForm).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume" })).toBeVisible();
  await expect(page.getByTestId("resume-list")).toContainText("Sunday");
  await expect(resumeForm).toBeHidden();
  await expect(startToggle).toHaveCount(0);
});

test("a new workstation must be named before anything else, and can be renamed", async ({
  page,
}) => {
  await page.goto(appUrl());
  const form = page.getByTestId("workstation-form");
  await expect(form.getByRole("heading", { name: "Name this workstation" })).toBeVisible();
  await expect(form.getByLabel("Workstation name")).toBeFocused();
  await expect(page.getByTestId("start-form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join session" })).toHaveCount(0);

  await form.getByLabel("Workstation name").fill("   ");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Enter a name for this workstation.")).toBeVisible();

  await form.getByLabel("Workstation name").fill("Front desk 1");
  await form.getByLabel("Workstation name").press("Enter");
  await expect(page.getByTestId("workstation")).toHaveText(/Workstation: Front desk 1/);
  await expect(page.getByTestId("start-form")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("workstation")).toHaveText(/Workstation: Front desk 1/);
  await expect(form).toHaveCount(0);

  await page.getByRole("button", { name: "Rename" }).click();
  await expect(form.getByLabel("Workstation name")).toHaveValue("Front desk 1");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("workstation")).toHaveText(/Front desk 1/);
  await page.getByRole("button", { name: "Rename" }).click();
  await form.getByLabel("Workstation name").fill("Returns desk");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("workstation")).toHaveText(/Workstation: Returns desk/);
});
