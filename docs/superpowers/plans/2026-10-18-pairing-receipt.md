# Pairing Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workstation without a working webcam can still pair. One station prints its pairing code as a receipt (QR + numbered Code 128 barcodes), and staff scan the barcodes into the other station with the USB scanner.

**Architecture:** Pure chunking (`src/pairing/chunks.ts`) splits an `OC1:` code into headered pieces and reassembles them. A Code 128 module (`src/print/code128.ts`) sizes and draws each piece as SVG at a fixed 0.25 mm module. A pairing-receipt renderer feeds Feature 1's `printElement`. `QrScan.vue` gains a scanner field that collects pieces (Enter or Tab ends one) and emits the rebuilt code through the same `decoded` event as the camera and paste box.

**Tech Stack:** Vue 3, TypeScript, jsbarcode (CODE128), qrcode (`QRCode.create`), Vitest, Playwright, pdftoppm + zxing-wasm (dev) for decode checks.

**Spec:** the feature request (Feature 2) quoted in this session; `src/pairing/payload.ts` for the code format; `docs/superpowers/specs/2026-10-10-offline-checkout-design.md` §5.1.

## Global Constraints

- Branch `feat/pairing-receipt` from the tip of `feat/receipt-print`; reuse `printElement`, `RECEIPT_WIDTH_MM` (src/print/print.ts) and `stubPrint`/`printed`/`printToPdf` (e2e/helpers/print.ts).
- Commit style `feat: ...`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Barcodes: Code 128 via jsbarcode `format: "CODE128"`, never Code 39 (codes are case-sensitive base64url).
- Narrow bar (one module) ≥ 2 printer dots = 0.25 mm; quiet zone ≥ 10 modules each side; whole symbol fits 72 mm at 203 dpi.
- Receipt order: QR code first, then barcodes `1 of N` … `N of N`, each labelled in readable text.
- Each chunk carries a short header: set id, index, total.
- Scanner field: Enter or Tab ends a chunk, both `preventDefault`ed so focus stays in the field. Any order, repeats ignored, progress shown, other-set chunks rejected with a clear message. A complete `OC1:...` typed into the field + Enter/Tab is accepted immediately.
- Must not conflict with `src/ui/scan-capture.ts` (it ignores keys in editable, non-readonly fields).
- Codes expire after 5 minutes; print-then-scan must fit comfortably.
- `npm run check`, `npm test`, `npm run e2e` pass; README updated.

## Decisions (list them in the PR)

1. **Chunk format:** `SSIT` + data, where `SS` = set id (2 chars `[A-Z0-9]`, random per printed code), `I` = 1-based index and `T` = total, each one base-36 digit (`1`–`9`, `A`–`Z`), uppercase. Header = 4 chars. Max 35 chunks (a code longer than 35 × 16 = 560 chars cannot be printed: show "This code is too long to print. Use the camera or Copy instead.").
2. **Chunk length:** 20 symbol characters (4 header + 16 data). Worst case Code 128 B: (20 × 11 + 35) modules + 2 × 10 quiet = 275 modules × 0.25 mm = 68.75 mm ≤ 72 mm, leaving ~1.6 mm spare each side. 21 chars would be 71.5 mm — too tight against driver rounding.
3. **No rotation.** Rotating along the receipt would allow fewer, longer barcodes (e.g. 40 chars ≈ 124 mm long), but many handheld linear scanners cannot read a symbol that wide in one sweep. Horizontal barcodes that fit 72 mm are the safer choice. Typical codes are 224–260 chars (measured from the SDP fixtures) → 14–17 barcodes.
4. **Rendering:** jsbarcode draws into an `<svg>` with `width: 1, margin: 10, displayValue: false`; we set `viewBox="0 0 W H"`, `preserveAspectRatio="none"`, `shape-rendering="crispEdges"`, CSS width `W × 0.25 mm`, bar height 10 mm. The QR is drawn as SVG rects from `QRCode.create(code, { errorCorrectionLevel: "M" })` (synchronous), 50 mm square with a 4-module quiet zone.
5. **Receipt text:** title `Offline Checkout — Join code` / `— Reply code`, session name, `Expires at HH:MM` for the join code (the reply code has no known expiry), a one-line instruction `Scan the QR, or scan every barcode below in any order`, then the barcodes with `n of N` under each.
6. **Scanner field is not auto-focused.** On the pair screens a session may be open and `scan-capture` records ordinary scans into it; autofocusing would divert those. Staff click the field (label `Scanner (printed code)`, placeholder `Click here, then scan the barcodes`).
7. **Timing:** the joiner currently gives up 45 s after showing its reply code (`CONNECT_TIMEOUT_MS`). Printing the reply and scanning ~16 barcodes takes longer, so the joiner's wait becomes the offer lifetime (5 min); the inviter's 45 s wait after the reply is entered stays. Whether WebRTC on the joiner survives that wait (link.ts closes on `connectionState === "failed"`) is verified by an e2e test with a 120 s delay; if it fails, fix it in Task 4 (see there).

## Review Focus

1. **A chunk from the other receipt** (join vs reply pieces mixed up): rejected, progress kept, clear message (Task 1 unit + Task 3 e2e).
2. **Scanner sends CR LF / Enter then Tab** (empty chunk): ignored silently (Task 3).
3. **Barcode scanned into the field before any session pieces, e.g. a library item barcode:** `That barcode is not part of a pairing code.` (Task 1/3).
4. **Slow pairing:** reply entered 2 minutes after it was shown still connects (Task 4 e2e).
5. **Printed size drift:** every barcode decodes from a 203 dpi raster of the printed PDF (Task 4).

---

### Task 1: Chunk splitting and collecting

**Files:**
- Create: `src/pairing/chunks.ts`
- Test: `src/pairing/chunks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CHUNK_HEADER = 4;
  export const CHUNK_DATA = 16;
  export const MAX_CHUNKS = 35;
  export interface Chunk { set: string; index: number; total: number; data: string }
  export function newSetId(): string; // 2 chars [A-Z0-9], crypto random
  export function splitCode(code: string, set?: string): string[]; // throws Error("too long") above MAX_CHUNKS
  export function parseChunk(text: string): Chunk | null; // null unless /^[A-Z0-9]{2}[1-9A-Z][1-9A-Z][A-Za-z0-9_:-]{1,16}$/ and index <= total
  export interface Collector { set: string | null; total: number; parts: Map<number, string> }
  export const emptyCollector: () => Collector;
  export type AddResult =
    | { kind: "full"; code: string }            // text starts with "OC1:" — use as-is
    | { kind: "added" | "repeat"; collector: Collector }
    | { kind: "complete"; code: string }        // all parts in; collector should be reset
    | { kind: "other-set" | "invalid" };
  export function addScan(c: Collector, text: string): AddResult; // trims; never mutates `c`
  export function missing(c: Collector): number[];
  export function progressText(c: Collector): string; // "Received 5 of 12 — missing 3, 9"; all in → "Received 12 of 12"
  ```
  Messages (exact copy, used by Task 3): other-set → `That barcode is from a different printed code. Scan the barcodes from one receipt, or click Start over.`; invalid → `That barcode is not part of a pairing code.`

- [ ] **Step 1: Failing tests:**
  - `splitCode` of a 260-char `OC1:` code → 17 chunks, each ≤ 20 chars, all share the set id, headers `1`..`H` with total `H` (base 36: 17 → `H`); joining data in order gives the code.
  - Round trip through `addScan` in shuffled order with one repeat (`repeat`) → final `complete` with the original code; `progressText` after 5 of 12 with 3 and 9 missing → `"Received 5 of 12 — missing 3, 9"`.
  - Chunk from another set after one accepted → `other-set`, collector unchanged.
  - Same set but different total → `invalid`.
  - `"OC1:abc"` → `full`; `"31234567890123"` (item barcode) → `invalid`; `""` and `"  "` → `invalid` (Task 3 ignores empty before calling).
  - Single-chunk code (`total` 1) completes on its only chunk.
  - Code of 561 chars → `splitCode` throws; 560 chars → 35 chunks.
  - Case is preserved in data (lower-case letters, `-`, `_`).
- [ ] **Step 2:** `npx vp test run src/pairing/chunks.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: split pairing codes into numbered barcode chunks`.

### Task 2: Code 128 + QR drawing and the pairing receipt; Print code button

**Files:**
- Create: `src/print/code128.ts`, `src/print/code128.test.ts`
- Create: `src/print/pairing-receipt.ts`
- Modify: `src/qr/QrDisplay.vue` (Print code button), `src/ui/screens/PairScreen.vue` (pass session name / expiry)

**Interfaces:**
- Consumes: `splitCode`, `newSetId` (Task 1); `printElement`, `RECEIPT_WIDTH_MM` (src/print/print.ts).
- Produces:
  ```ts
  // src/print/code128.ts
  export const MODULE_MM = 0.25;
  export const QUIET_MODULES = 10;
  export function code128Modules(text: string): string; // "1"/"0" pattern incl. start, check, stop; via JsBarcode on a plain object target, like src/pdf/code39.ts
  export function code128WidthMm(text: string): number; // (modules + 2 * QUIET_MODULES) * MODULE_MM
  export function code128Svg(text: string, heightMm: number): SVGSVGElement;
  // src/print/pairing-receipt.ts
  export interface PairingReceipt { label: "Join code" | "Reply code"; code: string; sessionName?: string; expiresAt?: number }
  export function renderPairingReceipt(r: PairingReceipt): HTMLElement; // data-chunk attribute on each barcode's wrapper holds its text (tests only)
  export function printPairingCode(r: PairingReceipt): void; // printElement(renderPairingReceipt(r))
  ```
  QrDisplay gets optional props `sessionName?: string; expiresAt?: number` and a `Print code` button next to `Copy`, calling `printPairingCode({ label, code: text, sessionName, expiresAt })`; on a "too long" error show the message from Decision 1 under the buttons. PairScreen passes `session.meta?.name` and `invite.expiresAt` for the join code, `offer?.sessionName` for the reply code.

- [ ] **Step 1: Failing tests** (`code128.test.ts`, node env — no DOM needed for modules):
  - For 1 000 random 20-char strings over the base64url alphabet + `:` and every chunk of `splitCode` on random codes up to 560 chars: `code128WidthMm(t) <= 70` and `(modules.length + 20) * 2 <= 576` dots.
  - `code128Modules("AB12")` starts with the Code 128 start B/C pattern `11010010000` or `11010011100` and ends with stop `1100011101011`.
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** `npm test` and `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat: print pairing codes as QR plus Code 128 barcodes`.

### Task 3: Scanner field in QrScan

**Files:**
- Modify: `src/qr/QrScan.vue`
- Modify: `src/ui/scan-capture.test.ts` (one regression test)

**Interfaces:**
- Consumes: `emptyCollector`, `addScan`, `progressText`, messages (Task 1); existing `emitText`.

Behaviour: an `<input type="text" autocomplete="off" spellcheck="false">` labelled `Scanner (printed code)` above the paste box. `@keydown`: on `Enter` or `Tab` (no modifiers) → `preventDefault()`, take and clear the value, ignore if blank, else `addScan`:
- `full` / `complete` → reset collector, clear status, `emitText(code)`.
- `added` / `repeat` → store collector, status `progressText` (role `status`, `data-testid="chunk-progress"`).
- `other-set` / `invalid` → keep collector, show the message (role `alert`, `data-testid="chunk-error"`); cleared by the next accepted chunk.
A `Start over` button (visible once a piece is held) resets the collector. `reset()` (exposed) also resets it.

- [ ] **Step 1:** Add to `scan-capture.test.ts`: a keydown targeted at an element matching `input:not([readonly])` with keys `A`, `Enter` does not call `onScan` and does not `preventDefault` (pins that the field's own handler owns these keys).
- [ ] **Step 2:** Implement the field.
- [ ] **Step 3:** `npm test && npm run check` → PASS.
- [ ] **Step 4:** Commit `feat: collect printed pairing barcodes with the USB scanner`.

### Task 4: Timing, e2e, decode check, README

**Files:**
- Modify: `src/ui/screens/PairScreen.vue` (joiner wait)
- Create: `e2e/pairing-receipt.spec.ts`
- Modify: `e2e/helpers/print.ts` (add `decodePrintedBarcodes`)
- Modify: `README.md`

**Interfaces:**
- Produces: `export async function decodePrintedBarcodes(pdfPath: string): Promise<{ code128: string[]; qr: string[] }>` — `pdftoppm -r 203 -gray -png`, then zxing-wasm `readBarcodesFromImageFile` with formats `["Code128","QRCode"]`, `maxNumberOfSymbols: 255`, `tryHarder: true`; reuse the local-wasm loader in `e2e/helpers/pdf.ts` (export it).

- [ ] **Step 1: Joiner wait:** in `submitName`, wait for `joined.connected` up to `JOIN_WAIT_MS = 300_000` instead of `CONNECT_TIMEOUT_MS`; keep 45 s for the inviter's `accept`.
- [ ] **Step 2: e2e `e2e/pairing-receipt.spec.ts`** (two contexts, `stubPrint` on both, no camera use):
  - Inviter: Add workstation → click `Print code` under Join code → one print; `printToPdf` → `decodePrintedBarcodes` → exactly one QR equal to the Join code box text, and N Code 128 texts; rebuild via chunk data order equals the join code. `console.log` N (report it in the PR).
  - Joiner: Join session → click `Scanner (printed code)` → type the chunks shuffled, one repeated, alternating `\n` (Enter) and `Tab` → progress text updates (assert one intermediate `Received k of N — missing ...`) → after the last chunk the `Join <session>?` confirmation appears. Join, name `Ben`, Continue.
  - Joiner: `Print code` under Reply code → decode → type chunks into the inviter's scanner field; first type one chunk from the **join** receipt → `chunk-error` shows the other-set message. Both stations reach the Scanner input.
  - Second test: typing the full `OC1:` join code + `Tab` into the joiner's scanner field goes straight to the confirmation.
  - Third test ("slow print"): pair as above but wait 120 s after the reply code is shown before typing the reply chunks into the inviter → both connect. `test.setTimeout(240_000)`.
    If this fails because the joiner's link closes on ICE `failed`: in `src/mesh/link.ts` do not close a link on `failed` before its handshake completes; let the mesh's invite timer / the joiner wait own that timeout. Add a unit test in `src/mesh/link.test.ts` for that.
- [ ] **Step 3:** `npm run e2e -- pairing-receipt` → PASS.
- [ ] **Step 4: README** step 2 (Add workstation / join): no camera → click **Print code**, take the receipt to the other workstation, click **Scanner (printed code)** and scan the barcodes in any order (or the QR, if the scanner reads 2D codes); progress shows which are missing; repeat scans are ignored. Typical code: 14–17 barcodes; the whole exchange takes ~2–3 minutes, inside the 5-minute limit. Requirements: scanner must send Enter or Tab after each scan and transmit lower-case letters as-is (Code 128).
- [ ] **Step 5:** `npm run check && npm test && npm run e2e` → all PASS.
- [ ] **Step 6:** Commit `feat: pair without a camera via printed barcodes` / `docs: ...`.
