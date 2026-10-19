import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { readBarcodesFromImageFile } from "zxing-wasm/reader";
import { useLocalWasm } from "./pdf";

const run = promisify(execFile);

export interface Printed {
  /** innerText of #oc-print-root. */
  text: string;
  /** The print style and root, for re-rendering with printToPdf. */
  html: string;
  /** What the screen showed (innerText of the body) when print was called. */
  screen: string;
  /** A frame was rendered after the screen's last change (the print container aside) and before print. */
  painted: boolean;
}

declare global {
  interface Window {
    __printed?: Printed[];
  }
}

/**
 * Before page.goto: replace window.print with a stub that records each printed receipt, then fires
 * afterprint. With `throws`, it records nothing and throws, as a failing print would.
 */
export async function stubPrint(page: Page, opts: { throws?: boolean } = {}): Promise<void> {
  await page.addInitScript((throws) => {
    window.__printed = [];
    let frame = 0;
    let changedAt = -1;
    const countFrames = () => {
      frame++;
      requestAnimationFrame(countFrames);
    };
    requestAnimationFrame(countFrames);
    const isPrint = (n: Node) => {
      const el = n instanceof Element ? n : n.parentElement;
      return !!el?.closest("#oc-print-root, #oc-print-style");
    };
    const note = (records: MutationRecord[]) => {
      for (const r of records) {
        if (isPrint(r.target) || [...r.addedNodes, ...r.removedNodes].some(isPrint)) continue;
        changedAt = frame;
      }
    };
    const observer = new MutationObserver(note);
    document.addEventListener("DOMContentLoaded", () =>
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      }),
    );
    window.print = () => {
      if (throws) throw new Error("print failed");
      note(observer.takeRecords());
      const painted = frame > changedAt;
      const root = document.getElementById("oc-print-root");
      const style = document.getElementById("oc-print-style");
      // The root is visibility:hidden on screen, so it is not part of the body's innerText.
      const screen = document.body.innerText;
      let text = "";
      if (root) {
        root.style.visibility = "visible";
        text = root.innerText;
        root.style.visibility = "";
      }
      const html = (style?.outerHTML ?? "") + (root?.outerHTML ?? "");
      window.__printed!.push({ text, html, screen, painted });
      setTimeout(() => dispatchEvent(new Event("afterprint")), 0);
    };
  }, opts.throws ?? false);
}

/** Everything printed so far (see Printed). */
export async function printed(page: Page): Promise<Printed[]> {
  return page.evaluate(() => window.__printed ?? []);
}

/** Print captured print HTML as Chrome does to the receipt printer, onto its roll paper; returns the PDF path. */
export async function printToPdf(html: string, saveAs: string): Promise<string> {
  const path = resolve("test-results", saveAs);
  await mkdir(dirname(path), { recursive: true });
  // page.pdf() only works in headless Chromium.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head></head><body>${html}</body></html>`);
    await page.pdf({ path, ...ROLL_PAPER, printBackground: true });
    return path;
  } finally {
    await browser.close();
  }
}

/** The Star TSP143 driver's only paper, "72mm x Receipt" (2.84 × 118.23 in): the page Chrome prints onto. */
export const ROLL_PAPER = { width: "72mm", height: "3003mm" };

/** Where ink lands on the first page, in mm from its top edge (null on a blank page). */
export async function inkExtentMm(
  pdfPath: string,
): Promise<{ top: number; bottom: number } | null> {
  const dpi = 50;
  const dir = await mkdtemp(join(tmpdir(), "oc-ink-"));
  try {
    await run("pdftoppm", [
      "-r",
      String(dpi),
      "-gray",
      "-f",
      "1",
      "-l",
      "1",
      pdfPath,
      join(dir, "p"),
    ]);
    const [file] = (await readdir(dir)).filter((f) => f.endsWith(".pgm"));
    const buf = await readFile(join(dir, file!));
    const header = buf.toString("latin1", 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
    if (!header) throw new Error("unexpected pdftoppm output");
    const [all, w, h] = [header[0], Number(header[1]), Number(header[2])];
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      const row = buf.subarray(all.length + y * w, all.length + (y + 1) * w);
      if (row.some((v) => v < 128)) {
        if (top < 0) top = y;
        bottom = y + 1;
      }
    }
    const mm = (px: number) => (px / dpi) * 25.4;
    return top < 0 ? null : { top: mm(top), bottom: mm(bottom) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Every Code 128 and QR code in the PDF, rasterised at the receipt printer's 203 dpi, top to bottom.
 * `mono` thresholds to black and white, as a thermal printer does.
 */
export async function decodePrintedBarcodes(
  pdfPath: string,
  colour: "gray" | "mono" = "gray",
): Promise<{ code128: string[]; qr: string[] }> {
  await useLocalWasm();
  const dir = await mkdtemp(join(tmpdir(), "oc-print-"));
  try {
    await run("pdftoppm", ["-r", "203", `-${colour}`, "-png", pdfPath, join(dir, "page")]);
    const pngs = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const found = { code128: [] as string[], qr: [] as string[] };
    for (const png of pngs) {
      const blob = new Blob([await readFile(join(dir, png))], { type: "image/png" });
      const results = await readBarcodesFromImageFile(blob, {
        formats: ["Code128", "QRCode"],
        maxNumberOfSymbols: 255,
        tryHarder: true,
      });
      results.sort((a, b) => a.position.topLeft.y - b.position.topLeft.y);
      for (const r of results) {
        if (r.isValid) (r.format === "QRCode" ? found.qr : found.code128).push(r.text);
      }
    }
    return found;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
