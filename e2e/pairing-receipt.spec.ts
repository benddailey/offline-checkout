import { expect, test, type Browser, type Page } from "@playwright/test";
import { addScan, emptyCollector, type Collector } from "../src/pairing/chunks";
import { appUrl } from "./helpers/app";
import { decodePrintedBarcodes, printed, printToPdf, stubPrint } from "./helpers/print";

const SESSION = "Front desk";
const OTHER_SET =
  "That barcode is from a different printed code. Scan the barcodes from one receipt, or click Start over.";

async function stations(
  browser: Browser,
): Promise<{ inviter: Page; joiner: Page; done: () => Promise<void> }> {
  const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
  const [inviter, joiner] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  for (const page of [inviter!, joiner!]) {
    await stubPrint(page);
    await page.goto(appUrl());
  }
  await inviter!.getByLabel("Session name").fill(SESSION);
  await inviter!.getByLabel("Clerk name").fill("Ann");
  await inviter!.getByRole("button", { name: "Start session" }).click();
  await expect(inviter!.getByLabel("Scanner input")).toBeVisible();
  return {
    inviter: inviter!,
    joiner: joiner!,
    done: async () => {
      for (const ctx of contexts) await ctx.close();
    },
  };
}

async function codeText(page: Page, label: string): Promise<string> {
  const box = page.getByLabel(label, { exact: true });
  await expect(box).not.toHaveValue("", { timeout: 15_000 });
  return box.inputValue();
}

/** Click Print code and return the receipt's text and HTML. */
async function printCode(page: Page): Promise<{ text: string; html: string }> {
  const before = (await printed(page)).length;
  await page.getByRole("button", { name: "Print code" }).click();
  await expect.poll(async () => (await printed(page)).length).toBe(before + 1);
  return (await printed(page))[before]!;
}

const sorted = (items: string[]) => [...items].sort();

/** Barcode texts as they would be scanned off the printed paper; every one must decode in gray and in mono. */
async function scanPaper(
  html: string,
  saveAs: string,
): Promise<{ code128: string[]; qr: string[] }> {
  const pdf = await printToPdf(html, saveAs);
  const gray = await decodePrintedBarcodes(pdf, "gray");
  const mono = await decodePrintedBarcodes(pdf, "mono");
  expect(sorted(gray.code128)).toEqual(sorted(chunksIn(html)));
  expect(sorted(mono.code128)).toEqual(sorted(chunksIn(html)));
  expect(mono.qr).toEqual(gray.qr);
  return gray;
}

function chunksIn(html: string): string[] {
  return [...html.matchAll(/data-chunk="([^"]+)"/g)].map((m) => m[1]!);
}

function rebuild(chunks: string[]): string {
  let c: Collector = emptyCollector();
  for (const chunk of chunks) {
    const r = addScan(c, chunk);
    if (r.kind === "complete") return r.code;
    if (r.kind !== "added") throw new Error(`unexpected ${r.kind} for ${chunk}`);
    c = r.collector;
  }
  throw new Error("incomplete");
}

/** Type each chunk into the focused scanner field, ending them alternately with Enter and Tab. */
async function scanChunks(page: Page, chunks: string[], start = 0): Promise<void> {
  for (const [i, chunk] of chunks.entries()) {
    await page.keyboard.type(chunk);
    await page.keyboard.press((start + i) % 2 ? "Tab" : "Enter");
  }
}

function shuffled<T>(items: T[]): T[] {
  return items
    .map((v, i) => ({ v, k: (i * 7 + 3) % items.length }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

test("two workstations pair by scanning printed barcodes", async ({ browser }) => {
  test.setTimeout(180_000);
  const { inviter, joiner, done } = await stations(browser);
  try {
    const startedAt = Date.now();
    await inviter.getByRole("button", { name: "Add workstation" }).click();
    const join = await codeText(inviter, "Join code");
    const joinReceipt = await printCode(inviter);
    for (const line of [`Offline Checkout — Join code`, SESSION, "Expires at", "Scan the QR"]) {
      expect(joinReceipt.text).toContain(line);
    }
    const joinPaper = await scanPaper(joinReceipt.html, "pairing-receipt/join.pdf");
    expect(joinPaper.qr).toEqual([join]);
    expect(joinPaper.code128).toHaveLength(chunksIn(joinReceipt.html).length);
    expect(rebuild(joinPaper.code128)).toBe(join);
    const n = joinPaper.code128.length;
    expect(joinReceipt.text).toContain(`${n} of ${n}`);
    console.log(`join code: ${join.length} chars, ${n} barcodes`);

    await joiner.getByRole("button", { name: "Join session" }).click();
    await joiner.getByLabel("Scanner (printed code)").click();
    // A library item barcode, then an empty scan (a scanner sending Enter then Tab).
    await joiner.keyboard.type("31234567890123\n");
    await expect(joiner.getByTestId("chunk-error")).toHaveText(
      "That barcode is not part of a pairing code.",
    );
    const order = shuffled(joinPaper.code128);
    await scanChunks(joiner, order.slice(0, 3));
    await joiner.keyboard.press("Enter");
    await joiner.keyboard.press("Tab");
    await expect(joiner.getByTestId("chunk-error")).toBeHidden();
    await expect(joiner.getByTestId("chunk-progress")).toHaveText(
      new RegExp(`^Received 3 of ${n} — missing \\d+(, \\d+)*$`),
    );
    await scanChunks(joiner, [order[1]!]);
    await expect(joiner.getByTestId("chunk-progress")).toContainText(`Received 3 of ${n}`);
    await expect(joiner.getByLabel("Scanner (printed code)")).toBeFocused();
    await scanChunks(joiner, order.slice(3), 1);
    await expect(joiner.getByRole("heading", { name: `Join ${SESSION}?` })).toBeVisible();
    await joiner.getByRole("button", { name: "Join", exact: true }).click();
    await joiner.getByLabel("Clerk name").fill("Ben");
    await joiner.getByRole("button", { name: "Continue" }).click();

    const reply = await codeText(joiner, "Reply code");
    const replyReceipt = await printCode(joiner);
    expect(replyReceipt.text).toContain("Offline Checkout — Reply code");
    expect(replyReceipt.text).not.toContain("Expires at");
    const replyPaper = await scanPaper(replyReceipt.html, "pairing-receipt/reply.pdf");
    expect(replyPaper.qr).toEqual([reply]);
    expect(rebuild(replyPaper.code128)).toBe(reply);
    const m = replyPaper.code128.length;
    console.log(`reply code: ${reply.length} chars, ${m} barcodes`);

    await inviter.getByLabel("Scanner (printed code)").click();
    const replyOrder = shuffled(replyPaper.code128);
    await scanChunks(inviter, replyOrder.slice(0, 1));
    await scanChunks(inviter, [joinPaper.code128[0]!]);
    await expect(inviter.getByTestId("chunk-error")).toHaveText(OTHER_SET);
    await expect(inviter.getByTestId("chunk-progress")).toContainText(`Received 1 of ${m}`);
    await scanChunks(inviter, replyOrder.slice(1));

    await expect(inviter.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    await expect(joiner.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    console.log(`print-then-scan pairing took ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  } finally {
    await done();
  }
});

test("barcodes scanned outside the scanner field still pair and are not recorded as scans", async ({
  browser,
}) => {
  const { inviter, joiner, done } = await stations(browser);
  try {
    await inviter.getByRole("button", { name: "Add workstation" }).click();
    await codeText(inviter, "Join code");
    const joinChunks = chunksIn((await printCode(inviter)).html);

    // No session is open on the joiner (Launch → Join session).
    await joiner.getByRole("button", { name: "Join session" }).click();
    await joiner.getByRole("heading", { name: "Join session" }).click();
    await expect(joiner.getByLabel("Scanner (printed code)")).not.toBeFocused();
    for (const chunk of joinChunks.slice(0, 2)) await joiner.keyboard.type(`${chunk}\n`);
    await expect(joiner.getByTestId("chunk-progress")).toContainText(
      `Received 2 of ${joinChunks.length}`,
    );
    for (const chunk of joinChunks.slice(2)) await joiner.keyboard.type(`${chunk}\n`);
    await joiner.getByRole("button", { name: "Join", exact: true }).click();
    await joiner.getByLabel("Clerk name").fill("Ben");
    await joiner.getByRole("button", { name: "Continue" }).click();
    await codeText(joiner, "Reply code");
    const replyChunks = chunksIn((await printCode(joiner)).html);

    await inviter.getByRole("heading", { name: "Add workstation" }).click();
    await expect(inviter.getByLabel("Scanner (printed code)")).not.toBeFocused();
    for (const chunk of replyChunks.slice(0, 3)) await inviter.keyboard.type(`${chunk}\n`);
    await expect(inviter.getByTestId("chunk-progress")).toContainText(
      `Received 3 of ${replyChunks.length}`,
    );
    await expect(inviter.getByTestId("message")).toHaveCount(0);
    for (const chunk of replyChunks.slice(3)) await inviter.keyboard.type(`${chunk}\n`);

    await expect(inviter.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    await expect(joiner.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    for (const page of [inviter, joiner]) {
      await expect(page.getByTestId("totals")).toHaveText("Patrons 0 · Items 0");
    }
  } finally {
    await done();
  }
});

test("a whole join code typed into the scanner field is used at once", async ({ browser }) => {
  const { inviter, joiner, done } = await stations(browser);
  try {
    await inviter.getByRole("button", { name: "Add workstation" }).click();
    const join = await codeText(inviter, "Join code");
    await joiner.getByRole("button", { name: "Join session" }).click();
    await joiner.getByLabel("Scanner (printed code)").click();
    await joiner.keyboard.type(join);
    await joiner.keyboard.press("Tab");
    await expect(joiner.getByRole("heading", { name: `Join ${SESSION}?` })).toBeVisible();
  } finally {
    await done();
  }
});

test("a reply scanned two minutes after it was shown still connects", async ({ browser }) => {
  test.setTimeout(240_000);
  const { inviter, joiner, done } = await stations(browser);
  try {
    await inviter.getByRole("button", { name: "Add workstation" }).click();
    await codeText(inviter, "Join code");
    const joinChunks = chunksIn((await printCode(inviter)).html);

    await joiner.getByRole("button", { name: "Join session" }).click();
    await joiner.getByLabel("Scanner (printed code)").click();
    await scanChunks(joiner, joinChunks);
    await joiner.getByRole("button", { name: "Join", exact: true }).click();
    await joiner.getByLabel("Clerk name").fill("Ben");
    await joiner.getByRole("button", { name: "Continue" }).click();
    await codeText(joiner, "Reply code");
    const replyChunks = chunksIn((await printCode(joiner)).html);

    await inviter.waitForTimeout(120_000);
    await inviter.getByLabel("Scanner (printed code)").click();
    await scanChunks(inviter, replyChunks);
    await expect(inviter.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
    await expect(joiner.getByLabel("Scanner input")).toBeVisible({ timeout: 15_000 });
  } finally {
    await done();
  }
});
