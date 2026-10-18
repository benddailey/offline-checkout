# Receipt Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a patron's visit ends (End patron button or the OC-END barcode), save the visit and then open the browser print dialog with a 72 mm receipt for that visit.

**Architecture:** A pure function builds the receipt data from `SessionState`; a small DOM module renders it into a print-only container and calls `window.print()`. The Pinia session store calls the printer (an injectable dependency) only after the `patron-ended` record is committed. `ScanInput` takes focus back on `afterprint`.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest (`vp test`), Playwright, pdfjs-dist/pdftoppm for checking the printed page size.

**Spec:** the feature request (Feature 1) quoted in this session, plus `docs/superpowers/specs/2026-10-10-offline-checkout-design.md` §4.2 (scanning loop).

## Global Constraints

- Branch `feat/receipt-print` from `main`. Commit style `feat: ...` / `docs: ...` / `test: ...`, every message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Printing is `window.print()` only; staff pick the printer in Chrome's dialog. No kiosk mode, no native helper.
- Printer: Star TSP143, 72 mm printable width, 203 dpi, auto-cutter.
- Receipt: session name, date and time, clerk, patron barcode, every non-voided item, item count. Plain black text, sized for 72 mm.
- The screen layout must not change: the receipt lives in a print-only container that is hidden on screen.
- The `patron-ended` record must be committed to IndexedDB before `window.print()` is called (`window.print()` blocks scripts while the dialog is open).
- No current visit → print nothing. A failed save → print nothing.
- After printing or cancelling, keyboard focus returns to the scanner input via the `afterprint` event.
- `npm run check`, `npm test`, `npm run e2e` must pass before the PR. README.md updated where staff-visible behaviour changes.

## Decisions (ambiguities resolved here; list them in the PR)

1. **Page size.** The requested `@page { size: 72mm auto; margin: 0 }` is invalid CSS in Chrome (verified: Chromium ignores it and prints US Letter, MediaBox `0 0 612 792`). The helper instead measures the receipt's rendered height and writes `@page { size: 72mm <height>mm; margin: 0 }`, one page per receipt, so the cutter cuts once.
2. **Print-only container, not an iframe.** A `<div id="oc-print-root">` plus an injected `<style id="oc-print-style">`, both added just before `window.print()` and removed on `afterprint`. This keeps `window.print` stubbable in e2e and leaves Ctrl+P on other screens unchanged. The injected stylesheet is self-contained (no Tailwind classes) so the receipt renders the same anywhere.
3. **Clerk** is the clerk who started the visit (`VisitState.employee`).
4. **Date and time** are the moment the visit ended on this workstation (`deps.now()`), formatted `YYYY-MM-DD HH:MM` (local).
5. **Item count** counts non-voided items: `Items: 1` / `Items: 2`.
6. **Void patron does not print** (only ending a visit does). A visit ended on another workstation does not print here.
7. Printing errors (e.g. DOM failure) are caught and shown as `Could not print the receipt` (tone `error`); the visit stays ended.

## Review Focus

1. **Order of save and print:** a slow IndexedDB append must finish before the print dialog opens — unit test with a gated append (Task 2).
2. **Visit with every item voided:** receipt prints with no item lines and `Items: 0` (Task 1).
3. **OC-END with no patron in progress:** message "No patron in progress", no print (Task 2, e2e Task 3).
4. **Hostile text** (session or clerk name containing `<img onerror>` from a peer): rendered with `textContent`, never `innerHTML` (Task 3 e2e asserts the name appears literally).
5. **Scanner focus after the dialog:** the next scan after printing goes into the scanner input, not a button (e2e Task 3).

---

### Task 1: Pure receipt builder

**Files:**
- Create: `src/print/receipt.ts`
- Test: `src/print/receipt.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `VisitState`, `RecordId` from `src/log/types.ts`; `reduce` in tests (build state from records with `src/log/helpers.test-util.ts` if it fits).
- Produces:
  ```ts
  export interface VisitReceipt {
    session: string;   // state.name ?? "Session"
    when: string;      // "YYYY-MM-DD HH:MM", local time
    clerk: string;     // visit.employee
    patron: string;
    items: string[];   // non-voided item barcodes, in visit order
  }
  export function visitReceipt(state: SessionState, visitId: RecordId, at: Date): VisitReceipt | null; // null: unknown or voided visit
  export function receiptLines(r: VisitReceipt): string[];
  ```
  `receiptLines` is the exact printed text, in order:
  `["Offline Checkout", r.session, r.when, `Clerk: ${r.clerk}`, `Patron: ${r.patron}`, ...r.items, `Items: ${r.items.length}`]`.

- [ ] **Step 1: Write failing tests** in `src/print/receipt.test.ts`:
  - `visitReceipt` for a visit P1 with I1, I2, I3 where I2 is voided → `items` `["I1","I3"]`, `clerk` the visit's employee, `session` the session name, `when` `"2026-10-18 09:05"` for `new Date(2026, 9, 18, 9, 5)`.
  - Every item voided → `items: []`, and `receiptLines` ends with `"Items: 0"`.
  - Unknown visit id → `null`; voided visit → `null`.
  - `state.name === null` → `session` `"Session"`.
  - `receiptLines` returns exactly the order above.
- [ ] **Step 2:** `npx vp test run src/print/receipt.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `src/print/receipt.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat: build visit receipts from session state`.

### Task 2: Print helper and wiring into the session store

**Files:**
- Create: `src/print/print.ts` (DOM: print root, injected style, `window.print()`)
- Create: `src/print/visit-receipt.ts` (DOM: `renderVisitReceipt`)
- Modify: `src/ui/session.ts` (new dep, print after `patron-ended` in both `endPatron` and the `CONTROL.END` branch of `processScan`)
- Modify: `src/ui/components/ScanInput.vue` (refocus on `afterprint`)
- Test: `src/ui/session.test.ts`

**Interfaces:**
- Consumes: `VisitReceipt`, `visitReceipt`, `receiptLines` (Task 1).
- Produces (Feature 2 reuses `printElement`):
  ```ts
  // src/print/print.ts
  export const PRINT_ROOT_ID = "oc-print-root";
  export const PRINT_STYLE_ID = "oc-print-style";
  export const RECEIPT_WIDTH_MM = 72;
  /** Show `content` as the only printed thing, sized 72 mm wide and exactly as tall as it is, then window.print(). */
  export function printElement(content: HTMLElement, extraCss?: string): void;
  // src/print/visit-receipt.ts
  export function renderVisitReceipt(r: VisitReceipt): HTMLElement;
  // src/ui/session.ts — SessionDeps gains
  printVisitReceipt: (r: VisitReceipt) => void; // default: r => printElement(renderVisitReceipt(r))
  ```

`printElement` behaviour:
1. Remove any previous root/style (a print that never fired `afterprint`).
2. Append `<div id="oc-print-root">` containing `content` to `document.body`, and `<style id="oc-print-style">` to `document.head`.
3. Base CSS (plus `extraCss`): on screen the root is `position: fixed; left: -10000px; top: 0; width: 72mm; visibility: hidden` so it can be measured without being seen; under `@media print` every `body > *` except the root is `display: none !important` and the root is `position: static; visibility: visible; width: 72mm`. Receipt text: black, `font: 11pt/1.3 Arial, sans-serif`, padding `2mm 3mm`, `overflow-wrap: anywhere` so long barcodes wrap inside 72 mm.
4. Measure `root.getBoundingClientRect().height` (CSS px → mm: `px * 25.4 / 96`), round up, add 4 mm, and append `@page { size: 72mm <h>mm; margin: 0 }` to the style.
5. Register a one-shot `afterprint` listener that removes root and style, then call `window.print()`.

`renderVisitReceipt` builds one `<div>` per `receiptLines` line using `textContent` only (never `innerHTML`); the first line bold and larger, the patron line bold, a thin black rule before the item list and before the count.

Session store: a local `printReceipt(visitId)` that runs after a successful `commit({type:"patron-ended"})` in **both** paths: `const r = visitReceipt(state.value, visitId, deps.now()); if (r) deps.printVisitReceipt(r);` wrapped in try/catch → `message.value = { tone: "error", text: "Could not print the receipt" }`.

ScanInput: `window.addEventListener("afterprint", refocusSoon)` on mount, removed on unmount.

- [ ] **Step 1: Write failing tests** in `src/ui/session.test.ts` (the fake deps get a `printVisitReceipt` spy that also records whether the `patron-ended` record is already in `s.records` and in the fake db log at call time):
  - `endPatron()` with P1, items I1 and I2 (I2 voided) → spy called once with `{ patron: "P1", items: ["I1"], clerk, session, when }`, and at call time the `patron-ended` record is in the fake store's log.
  - Scanning `OC-END` prints the same way.
  - A gated/slow append (use the fake db's existing gate) → spy not called until the append resolves.
  - No current visit: `endPatron()` and `scan("OC-END")` → spy not called.
  - Append fails → spy not called, `fatal` set as today.
  - `voidPatron()` → spy not called.
  - Spy throws → visit still ended, `message` is `{ tone: "error", text: "Could not print the receipt" }`.
- [ ] **Step 2:** `npx vp test run src/ui/session.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement `print.ts`, `visit-receipt.ts`, session wiring, ScanInput listener.
- [ ] **Step 4:** `npm test` → PASS; `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat: print a receipt when a patron's visit ends`.

### Task 3: End-to-end test, page-size check and README

**Files:**
- Create: `e2e/helpers/print.ts`
- Create: `e2e/receipt-print.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Produces (Feature 2's e2e reuses these):
  ```ts
  /** Before page.goto: replace window.print with a stub that records each printed receipt, then fires afterprint. */
  export async function stubPrint(page: Page): Promise<void>;
  /** Everything printed so far: innerText of #oc-print-root, and the style+root HTML for re-rendering. */
  export async function printed(page: Page): Promise<{ text: string; html: string }[]>;
  /** Render captured print HTML in a headless Chromium as PDF (print media, CSS page size); returns the path. */
  export async function printToPdf(html: string, saveAs: string): Promise<string>;
  ```
  The stub (via `page.addInitScript`) pushes `{ text: root.innerText, html: style.outerHTML + root.outerHTML }` to `window.__printed`, then `setTimeout(() => dispatchEvent(new Event("afterprint")), 0)` (asynchronous like the real dialog closing). `printToPdf` launches `chromium.launch({ headless: true })` (page.pdf needs headless), `setContent` with `<!doctype html><html><head></head><body>` + html, `page.pdf({ preferCSSPageSize: true, printBackground: true })`, saves under `test-results/`.

- [ ] **Step 1: Write `e2e/receipt-print.spec.ts`:**
  - Start session "Desk <b>1</b>" (literal tags, proves text escaping) with clerk "Ann"; scan `P1`, `I1`, `I2`; void I2; click **End patron** → exactly one print; its text contains `Desk <b>1</b>`, `Clerk: Ann`, `Patron: P1`, `I1`, `Items: 1` and today's date `YYYY-MM-DD`; does not contain `I2`.
  - After the print the scanner input is focused; typing `P2\n` starts patron P2.
  - Scan `I9`, then `OC-END` → a second print with `Patron: P2`, `I9`, `Items: 1`.
  - Scan `OC-END` with no patron → still two prints, message "No patron in progress".
  - Reload the page and resume the session: P1 and P2 are ended (the records were saved).
  - `printToPdf` of the first receipt → pdfjs page width is 72 mm (`204.09 ± 0.5` pt) and exactly one page; `pdfText` contains `Patron: P1`.
  - The app's screen is unchanged after printing: `#oc-print-root` no longer exists.
- [ ] **Step 2:** `npm run e2e -- receipt-print` → PASS (fix the implementation, not the test, if not).
- [ ] **Step 3: README:** in "Using it at the desk" → Scan: ending a patron (button or OC-END) opens the print dialog with a receipt; pick the Star receipt printer once (Chrome remembers the last printer), keep Scale at 100 % / Margins Default; Cancel skips the receipt and the visit stays ended. Add to Requirements: a receipt printer (Star TSP143 / TSP100 series, 72 mm) installed in Windows, optional. Known limitations: Chrome shows the print dialog every time (no silent printing from a file:// page).
- [ ] **Step 4:** `npm run check && npm test && npm run e2e` → all PASS.
- [ ] **Step 5:** Commit `test: e2e for visit receipts` and `docs: describe receipt printing` (or one `feat:` commit if small).
