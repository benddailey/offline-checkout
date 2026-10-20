# Offline Checkout: development

[README.md](README.md) is for library staff and ships in the release zip as `README.txt`. This file
is for working on the app.

## How it works

The app is a Vue 3 + Pinia app built into one self-contained HTML file and opened from `file://`.
Every scan is appended to a log in IndexedDB. Workstations pair over WebRTC data channels, with the
offer and answer exchanged as QR codes, pasted text or printed barcodes, so no server is needed. The
logs sync between paired workstations, and the closed session is exported as a PDF of Code 128
barcodes (jsPDF). Receipts are printed with the browser's print dialog, or silently with Chrome's
`--kiosk-printing` flag, which the desk shortcuts set.

## Stack

- **Language and UI:** TypeScript, Vue 3 (`<script setup>` single-file components), Pinia for state,
  Tailwind CSS 4.
- **Toolchain:** Vite+ (`vp`, the `vite-plus` package):
  - `vp build` and `vp dev` (Vite);
  - `vp test` (Vitest, imported from `vite-plus/test`);
  - `vp check` (formatting, oxlint and type checks).

  Use `vite-plus` imports rather than `vite` / `vitest` directly; lint enforces it. If `vp` is not
  on PATH, use `npx vp`.

- **Single file:** `vite-plugin-singlefile` inlines everything, including the zxing WebAssembly,
  into `dist/offline-checkout.html`.
- **Storage:** IndexedDB through `idb` (`src/store/`).
- **Barcodes and QR:**
  - `jsbarcode` makes Code 128 for receipts and the PDF;
  - `qrcode` draws QR codes;
  - `zxing-wasm` reads QR codes from the webcam. `src/qr/QrCamera.vue` opens the camera with
    `getUserMedia`, draws about eight frames a second to a canvas and decodes them with
    `readBarcodes` from `zxing-wasm/reader`.

    `src/qr/zxing.ts` hands the inlined `.wasm` to that reader with `prepareZXingModule`, so nothing
    is fetched from a CDN. Import it once at startup, before the first decode. There is only one
    copy of `zxing-wasm`, so it can be updated like any other dependency.
- **PDF:** `jspdf` (`src/pdf/`).
- **Pairing and sync:** browser WebRTC data channels, no library (`src/mesh/`, `src/pairing/`,
  `src/sync/`).
- **Tests:**
  - Vitest unit tests next to the code (`*.test.ts`), with `fake-indexeddb`;
  - Playwright end-to-end tests in `e2e/`, which decode the printed and PDF barcodes with
    `zxing-wasm` and `pdfjs-dist`.
- **Scripts:** `scripts/*.ts` run directly with Node 24 (`node scripts/x.ts`, no build step).

## Requirements

- Node.js 24 or newer and npm.

## Build

```
npm install
npm run build
npm run package:windows
```

- `npm run build` writes `dist/offline-checkout.html`.
- `npm run package:windows` zips it into `dist/offline-checkout-vX.Y.Z-windows.zip` with:
  - `windows/Create shortcuts.cmd` (CRLF line endings), which installs the app to
    `%LOCALAPPDATA%\OfflineCheckout\` and creates the desktop shortcuts;
  - `README.txt`, a plain-text copy of `README.md` with the version and date at the top.

The version comes from `package.json`. The build puts it in the page as `__APP_VERSION__` and as a
`<meta name="offline-checkout-version">` tag, which the shortcut script reads.

Keep `README.md` to headings, lists, bold, inline code and links. That is all the `README.txt`
conversion handles.

## Field probe

A small separate page checks a workstation for the things this app depends on: scanner behaviour,
the camera, and WebRTC on the local network. Build it with `npm run build:probe`. See
[docs/field-probe.md](docs/field-probe.md) for how to run it and read the results.

## Testing

- `npm test` runs the unit tests.
- `npm run check` runs formatting, lint and type checks.
- `npm run e2e` builds everything and runs the Playwright end-to-end tests. Screenshots of the main
  screens at 1366x768 are written to `test-results/screens/`. The browsers run headless; set
  `HEADED=1` to watch them (`HEADED=1 npm run e2e`, or with `npx playwright test <spec>`).

## Releasing

1. Start from an up-to-date, clean `main`.
2. Run the checks: `npm run check`, `npm test` and `npm run e2e`. All must pass.
3. If anything that touches the scanner, camera or WebRTC has changed, re-run the field probe on real
   library PCs first.
4. Bump the version with `npm version <major|minor|patch>`. This updates `package.json` and
   `package-lock.json`, commits, and creates a `vX.Y.Z` tag. Push both: `git push --follow-tags`.
5. From the tagged commit, run `npm run build && npm run package:windows`. Attach
   `dist/offline-checkout.html` and `dist/offline-checkout-vX.Y.Z-windows.zip` to the release.
6. Open the built file once from `file://` and do a quick check: start a session, scan a patron and
   an item, close the session and generate the PDF.

Sessions live in the browser profile, not the file, so installing a new version keeps them. A release
that changes the IndexedDB schema (`src/store/db.ts`) needs a migration.

## Known limitations

- The field probe must be run on real library PCs before rollout.
- Chrome may ask for camera permission on every pairing when the page is opened from `file://`.
- Chrome has no flag to name a printer. Kiosk printing uses the last printer chosen in that profile,
  which is why there is a printer setup shortcut without `--kiosk-printing`.
- Chrome ignores command-line flags when a window of the same profile is already open, so the
  printer setup window must be closed before opening the everyday shortcut.
- Pairing codes carry a format version (`OC2:`). A workstation refuses codes in another format, so
  staff are told to keep every desk on the same release.
- Barcodes are verified by zxing at 300 dpi, but still confirm them with the library's real scanners.
