import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

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
