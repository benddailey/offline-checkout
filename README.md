# Offline Checkout

Offline Checkout is a single HTML file that library front-desk staff open in Chrome or Edge to record
patron and item barcodes during a network outage. Several workstations can share one session by
pairing directly with each other over QR codes (WebRTC, no server, no internet). When the outage is
over, the session is closed and exported as a PDF with a scannable Code 128 barcode for every patron
and item, ready to be re-scanned into the library system.

## Requirements

- Chrome or Edge on Windows (any Chromium browser), opened from `file://`. No admin rights, no installs.
- A USB barcode scanner that types like a keyboard, reads Code 128 and sends Enter after each scan.
  To pair from printed codes it must also send Enter or Tab after each scan.
- A webcam on each workstation if you want to pair by QR (copy and paste works without one).
- Optional: a receipt printer (Star TSP143 / TSP100 series, 72 mm paper) installed in Windows, for
  patron receipts.
- To build: Node.js and npm.

## Build

```
npm install
npm run build
```

The result is `dist/offline-checkout.html`, one self-contained file. Copy it to each workstation and
open it in the browser.

## Using it at the desk

1. **Start.** Open the file, enter a session name (it defaults to today's date) and your name, and
   click Start session. Resume a stored session from the Resume list after a reload or crash.
2. **Add a workstation / join.** On the running workstation click Add workstation; it shows a QR code.
   On the new workstation click Join session, scan that code with its webcam, enter your name, then
   hold the reply QR it shows up to the first workstation's camera. If a camera is not available,
   use the Join code / Reply code boxes and paste them instead. Codes expire after 5 minutes and work once.
   - **No camera?** Click **Print code** under the Join code to print it as a receipt (a QR code plus
     numbered barcodes). Take the receipt to the other workstation and scan every barcode in any
     order, or the QR if the scanner reads 2D codes. The scans go to the **Scanner (printed code)**
     box without clicking it first. The progress line shows which pieces are still missing; repeat
     scans are ignored, and Start over clears what was scanned. The reply code prints and scans the
     same way. A typical code is 7–8 barcodes of digits only, so the exchange fits easily inside the
     5-minute limit. Every workstation must run the same version: a code from an older version is
     refused with a message saying so.
3. **Scan.** Scan the patron card, then each item. The scanner input always has focus; just scan.
   The status bar shows live totals and a green or red dot for each workstation.
   - Scan **OC-END** (or click End patron) to finish the patron and start the next one.
   - Ending a patron (End patron or OC-END) saves the visit, then opens the print dialog with a
     receipt for that patron. The first time, pick the Star receipt printer (Chrome remembers the
     last printer) and keep Scale at 100 % and Margins at Default. Cancel skips the receipt; the
     visit stays ended. Void patron does not print. The receipt shows the patron barcode, then one
     barcode per item in order, so staff can scan them into the ILS when it's back online.
   - Scan **OC-VOIDLAST** (or click Void on a row) to void the last item. Void patron voids the whole visit.
   - Print the scanner card (offered when a session starts, and on the Summary) to get the OC-END and
     OC-VOIDLAST barcodes on paper: **Receipt printer** prints it on the receipt roll, **Letter PDF**
     downloads it for a regular printer.
   - Voided entries stay on screen struck through; nothing is ever deleted.
4. **Summary.** Click Summary for totals, a per-clerk count and every patron with their items.
5. **Close and export.** Click Close session (all workstations stop accepting scans), then Generate PDF.
   The PDF is US Letter with the session name, date and Page X of Y on every page.

## Field probe

A small separate page checks a workstation for the things this app depends on (scanner behaviour,
camera, WebRTC on the local network). Build it with `npm run build:probe`. See
[docs/field-probe.md](docs/field-probe.md) for how to run it and read the results.

## Testing

- `npm test` runs the unit tests.
- `npm run check` runs formatting, lint and type checks.
- `npm run e2e` builds everything and runs the Playwright end-to-end tests. They run in a headed
  browser, so a display is required. Screenshots of the main screens at 1366x768 are written to
  `test-results/screens/`.

## Releasing

1. Start from an up-to-date, clean `main`.
2. Run the checks: `npm run check`, `npm test` and `npm run e2e` (needs a display). All must pass.
3. If anything that touches the scanner, camera or WebRTC has changed, re-run the field probe on real
   library PCs first (see [docs/field-probe.md](docs/field-probe.md)).
4. Bump the version with `npm version <major|minor|patch>`. This updates `package.json` and
   `package-lock.json`, commits, and creates a `vX.Y.Z` tag. Push both: `git push --follow-tags`.
5. Build from the tagged commit with `npm run build` and take `dist/offline-checkout.html`.
6. Open the built file once from `file://` and do a quick check: start a session, scan a patron and an
   item, close the session and generate the PDF.
7. Copy the file to each workstation, replacing the old copy. Sessions are stored in the browser
   profile, not the file, so replacing it keeps them, unless the release changes the IndexedDB
   schema (`src/store/db.ts`). That needs a migration. Don't swap the file during an outage.

## Known limitations

- The field probe must be run on real library PCs before rollout.
- Chrome may ask for camera permission on every pairing when the page is opened from `file://`.
- Chrome shows the print dialog for every receipt: a page opened from `file://` cannot print silently.
- Data lives in the browser profile; clearing site data or using another profile loses the session.
- Barcodes are verified by zxing at 300 dpi, but still confirm them with the library's real scanners.
