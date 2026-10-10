import { expect, type Page } from "@playwright/test";

/** Text of a QrDisplay's copy box, once it has been filled in. */
async function copyText(page: Page, label: string): Promise<string> {
  const box = page.getByLabel(label, { exact: true });
  await expect(box).not.toHaveValue("", { timeout: 15_000 });
  return box.inputValue();
}

async function paste(page: Page, text: string): Promise<void> {
  await page.getByLabel("Pasted code").fill(text);
  await page.getByRole("button", { name: "Use pasted code" }).click();
}

/**
 * Pair `joiner` (on the Launch screen, or an isolated workstation offering Re-pair) into `inviter`'s session using the copy boxes and paste
 * fields instead of cameras. Returns the codes exchanged.
 */
export async function pairViaPaste(
  inviter: Page,
  joiner: Page,
  joinerName: string,
): Promise<{ offer: string; answer: string }> {
  await inviter.getByRole("button", { name: "Add workstation" }).click();
  const offer = await copyText(inviter, "Join code");

  const repair = joiner.getByRole("button", { name: "Re-pair" });
  if (await repair.isVisible()) await repair.click();
  else await joiner.getByRole("button", { name: "Join session" }).click();
  await paste(joiner, offer);
  await joiner.getByRole("button", { name: "Join", exact: true }).click();
  await joiner.getByLabel("Clerk name").fill(joinerName);
  await joiner.getByRole("button", { name: "Continue" }).click();
  const answer = await copyText(joiner, "Reply code");

  await paste(inviter, answer);
  await expect(inviter.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
  await expect(joiner.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
  return { offer, answer };
}
