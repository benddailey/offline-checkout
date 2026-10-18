import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

declare global {
  interface Window {
    __printed?: { text: string; html: string }[];
  }
}

/** Before page.goto: replace window.print with a stub that records each printed receipt, then fires afterprint. */
export async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__printed = [];
    window.print = () => {
      const root = document.getElementById("oc-print-root");
      const style = document.getElementById("oc-print-style");
      let text = "";
      if (root) {
        // innerText skips visibility:hidden text, and on screen the root is hidden.
        root.style.visibility = "visible";
        text = root.innerText;
        root.style.visibility = "";
      }
      window.__printed!.push({ text, html: (style?.outerHTML ?? "") + (root?.outerHTML ?? "") });
      setTimeout(() => dispatchEvent(new Event("afterprint")), 0);
    };
  });
}

/** Everything printed so far: innerText of #oc-print-root, and the style+root HTML for re-rendering. */
export async function printed(page: Page): Promise<{ text: string; html: string }[]> {
  return page.evaluate(() => window.__printed ?? []);
}

/** Render captured print HTML in a headless Chromium as PDF (print media, CSS page size); returns the path. */
export async function printToPdf(html: string, saveAs: string): Promise<string> {
  const path = resolve("test-results", saveAs);
  await mkdir(dirname(path), { recursive: true });
  // page.pdf() only works in headless Chromium.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head></head><body>${html}</body></html>`);
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    return path;
  } finally {
    await browser.close();
  }
}
