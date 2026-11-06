# Offline Checkout: development

[README.md](README.md) is for library staff and ships in the release zip as `README.txt`. This file
is for working on the app.

## How it works

The app is a Vue 3 + Pinia app built into one self-contained HTML file and opened from `file://`.
Every scan is appended to a log in IndexedDB. Workstations pair over WebRTC data channels, with the
offer and answer exchanged as QR codes, pasted text, printed barcodes or temporary code files, so no
server is needed. The logs sync between paired workstations, and the closed session is exported as a
PDF of Code 128 barcodes (jsPDF), as CSV or Excel files, or as an Evergreen offline transaction
file. Receipts are printed with the browser's print dialog, or silently with Chrome's
`--kiosk-printing` flag, which the desk shortcuts set.

## Stack

- **Language and UI:** TypeScript, Vue 3 (`<script setup>` single-file components), Pinia for state,
  Tailwind CSS 4. Buttons and text fields take their classes from `src/ui/classes.ts`. Each variant
  is complete: a second colour or size class beside one loses or wins by CSS order, not class order,
  so add a variant instead. Printed receipts use their own CSS in `src/print/`, sized in mm and pt.
- **Themes:** screens use colour tokens from `src/style.css` (`bg-surface`, `text-ink`), never
  Tailwind's palette; `src/ui/theme.test.ts` fails on a raw palette class. The `@theme` block is
  Light. To add a theme, add a `[data-theme="<id>"]` block overriding the tokens that differ, and
  an entry in `THEMES` (`src/ui/theme.ts`). Leave `code`, `camera` and `camera-ink` alone: QR codes
  need their white margin to scan. Set `color-scheme` to match, and check that text keeps at least
  4.5:1 contrast. The choice is per browser profile, in `localStorage` so it applies before the
  app mounts, and isn't synced. The chooser is a button because `ScanInput` leaves focus on a
  `<select>`, so a scan would go into it. The field probe imports the same CSS but stays Light.
- **Toolchain:** Vite+ (`vp`, the `vite-plus` package):
  - `vp build` and `vp dev` (Vite);
  - `vp test` (Vitest, imported from `vite-plus/test`);
  - `vp check` (formatting, oxlint and type checks).

  Use `vite-plus` imports rather than `vite` / `vitest` directly; lint enforces it. If `vp` is not
  on PATH, use `npx vp`.

- **Single file:** `vite-plugin-singlefile` inlines everything, including the zxing WebAssembly,
  into `dist/offline-checkout.html`.
- **Storage:** IndexedDB through `idb` (`src/store/`). The `offline-checkout` database indexes the
  sessions, and each session's log is in its own `oc-session-<id>` database. `listSessions` reads
  the log of every session not yet seen closed, to find closes from peers and the last activity.
  The `device` store also holds the workstation name staff give each browser profile on first
  launch. `createSession` and `openSessionStore` copy it into the session's meta, and `append()`
  stamps it on each record as an optional `workstation` field beside `employee`. Records from before
  names have none and show as "Not named". It is not part of the pairing payload.
  The start page uses that last activity: if an open session has a record from the last 72 hours,
  the page lists open sessions first with the latest one expanded, and the start form sits behind
  a **Start new session** button.
  `listSessions` also gives each open session every other workstation's latest record, by `seq`,
  when it has a name. The start page lists those from the last 72 hours under **Other workstations**
  (`src/ui/workstations.ts`). It is only the last activity synced here: the start page has no mesh,
  so it cannot show which are online.
  Each PDF, CSV, Excel or Evergreen download appends an `exported` record (`kind`), which syncs like
  any other record and lets the delete dialog show who exported what. The reducer lists them in order.
- **Adding to a session** (`src/import/`, design in
  `docs/superpowers/specs/2026-11-06-session-import-design.md`). Records copied in from another
  session or a file carry the envelope flag `imported: true` (`isLogRecord` accepts only `true` or
  absent). Two record types go with it: `imported` (`source`, `name`, `patrons`, `items`; one per
  source that added something, reduced into `SessionState.imports`) and `import-gap`, a placeholder
  that `reduce` ignores. `VisitState.imported` marks visits that came in.
  - Adding a session rewrites each record, because the same PC has the same `deviceId` in both
    sessions and `(deviceId, seq)` would collide. `deviceId`, `visitId` and `target` become
    `mergedDeviceId(sourceSessionId, deviceId)`-derived ids, so adding twice stores nothing new.
    `seq`, `at`, `employee` and `workstation` are kept.
  - `session-created`, `session-closed`, `exported` and `imported` records become `import-gap`, since
    copied as they are they would rename or close the session. They can't be left out: `vectorOf`
    stops at the first missing `seq`, and a gap would make peers resend that device's later records
    every 10 seconds for the life of the session.
  - A `deviceId` that carries `imported` isn't a PC. Leave it out of `knownDevices`, `notConnected`,
    `disconnected`, `othersInProgress` and the `readLog` workstations (spec section 5).
  - Excel files are read with a small hand-written XML scanner (`src/import/xml.ts`), not
    `DOMParser`. Unit tests run in Vitest's `node` environment, which has no `DOMParser`, so they
    exercise the code that ships, with no new dependency. It also keeps memory flat on large sheets.
  - `evergreenStale` (`src/ui/exports.ts`) is true when an `imported` record is later than the latest
    Evergreen download. The Summary then shows `evergreen-stale` and the delete dialog asks for a new
    download.
  - `MessageBanner` and `SessionClosedBanner` scroll themselves into view, because `ScanInput`
    refocuses with `preventScroll` and a banner shown while the page is scrolled down would be missed.
  - No pairing change, so the prefix stays `OC3:`. A release before this one rejects the new records,
    so its peers keep getting them resent every 10 seconds. All desks must run the same version, as
    already required.
- **Barcodes and QR:**
  - `jsbarcode` makes Code 128 for receipts and the PDF;
  - `qrcode` draws QR codes;
  - `zxing-wasm` reads QR codes from the webcam. `src/qr/QrCamera.vue` opens the camera with
    `getUserMedia`, draws about eight frames a second to a canvas and decodes them with
    `readBarcodes` from `zxing-wasm/reader`.

    `src/qr/zxing.ts` hands the inlined `.wasm` to that reader with `prepareZXingModule`, so nothing
    is fetched from a CDN. Import it once at startup, before the first decode. There is only one
    copy of `zxing-wasm`, so it can be updated like any other dependency.
- **PDF:** `jspdf` (`src/pdf/`). `drawBars` writes each barcode straight into the page stream as one
  filled path in module units, scaled with `cm`, through the untyped `doc.internal.write`. A
  `rect()` call per bar was most of a large session's PDF time and size. Coordinates are kept to 3
  decimals of a point (`floatPrecision: 3`), far finer than a printer dot.
- **CSV and Excel:** written by hand in `src/export/`, one row per item in the PDF's order.
  - The CSV has a UTF-8 BOM and CRLF lines. A cell starting with `=`, `+`, `-` or `@` gets a `'`
    in front so Excel doesn't run it as a formula.
  - The `.xlsx` is a minimal SpreadsheetML package (inline strings, no shared strings table) zipped
    with `fflate`, which jsPDF also uses. Barcodes are text cells, so Excel keeps leading zeros.
- **Evergreen file:** `src/export/xacts.ts` writes Evergreen's offline transaction format (one JSON
  object per line, as `Open-ILS/web/js/ui/default/staff/offline.js` exports and
  `Open-ILS/src/offline/offline.pl` reads). Each item is a `checkout` with `patron_barcode`,
  `barcode`, `timestamp` (epoch seconds) and `checkout_time` (ISO 8601). There is no `due_date`:
  Evergreen then applies its loan rules from `checkout_time`, and needs no `CIRC_OVERRIDE_DUE_DATE`
  permission.
- **Pairing and sync:** browser WebRTC data channels, no library (`src/mesh/`, `src/pairing/`,
  `src/sync/`). Code files (`src/pairing/file.ts`) are saved with `showSaveFilePicker`, so staff can
  pick a network share or flash drive, and fall back to a download; loading takes the first `OC<n>:`
  code in the text. `CODE_TTL_MS` (15 minutes, `src/pairing/payload.ts`) is checked locally and is
  not in the payload. The joiner's answer is DTLS-passive (`passiveAnswer` in `src/pairing/sdp.ts`,
  set in `Mesh.join`, and `rebuildSdp` writes `passive` for answers), because the reply can be
  applied up to `CODE_TTL_MS` later: an active joiner keeps resending its ClientHello and Chromium
  gives up after about 222 s. That changed the handshake, so the prefix went to `OC3:` and the
  payload's first byte to `0x28` (printed barcodes carry only the bytes). Mesh introductions relay
  full SDPs and keep the browser's roles. A catch-up arrives as many 200-record batches at once.
  `SyncEngine` writes all the batches that arrive during a write in one `put()`, and `put()` queues
  its IndexedDB requests without awaiting each one, because every write is a disk flush and a full
  re-reduce of the log. Deleting a closed session sends `{t:"delete-session", workstation}` to the
  connected peers and waits up to 3 s (`DELETE_REPLY_MS`) for each `{t:"deleted"}`. A peer with that
  session closed replies, waits for the sender to disconnect (or 1 s), then deletes it; a peer with
  it open ignores the message. A `deleted` reply means the peer accepted the delete and is removing
  its copy, not that its copy is already gone. The sender then deletes its own copy and shows which
  peers did not confirm. Peers that were not connected keep their copy.
- **Tests:**
  - Vitest unit tests next to the code (`*.test.ts`), with `fake-indexeddb`;
  - Playwright end-to-end tests in `e2e/`, which decode the printed and PDF barcodes with
    `zxing-wasm` and `pdfjs-dist`.
- **Scripts:** `scripts/*.ts` run directly with Node 24 (`node scripts/x.ts`, no build step).

## Requirements

- Node.js 24 or newer and npm.

## Dev server

`npm run dev` starts Vite on port 5173. The entry page is `offline-checkout.html`, not `index.html`,
so open http://localhost:5173/offline-checkout.html. The bare root returns a 404.

## Build

```
npm install
npm run build
npm run package
```

- `npm run build` writes `dist/offline-checkout.html` and `dist/THIRD-PARTY-NOTICES.md`.
- `npm run package` zips it into `dist/offline-checkout-vX.Y.Z.zip`, one download for every system,
  with:
  - `Windows - Create shortcuts.cmd` from `windows/Create shortcuts.cmd` (CRLF line endings). It
    installs the app and the icons to `%LOCALAPPDATA%\OfflineCheckout\` and creates the desktop
    shortcuts. Chrome, else Edge.
  - `Mac - Create shortcuts.command` from `macos/Create shortcuts.command` (LF, executable). It
    installs the app to `~/Library/Application Support/OfflineCheckout/` and builds two launcher
    apps in `~/Applications` with `osacompile`, so their executable is native and Apple Silicon
    never asks for Rosetta. Each applet runs its `Contents/Resources/launch.sh`, which runs
    `open -na <browser> --args ...`; the script swaps in the `.icns` and re-signs the bundle ad hoc.
    Chrome, else Edge. It must stay compatible with the bash 3.2 that macOS ships.
  - `Linux - Create shortcuts.sh` from `linux/Create shortcuts.sh` (LF, executable). It installs the
    app, the icons and the browser profile to `~/OfflineCheckout/` and writes freedesktop `.desktop`
    launchers to `~/.local/share/applications` and the desktop, which every desktop environment
    reads. Chromium, else Chrome, else Edge, then the same as Flatpaks. The folder is visible
    because Snap Chromium, Ubuntu's only Chromium, cannot read hidden folders such as `~/.local`.
  - `icons/`: the `.ico`, `.icns` and `.png` shortcut icons for the three scripts;
  - `README.txt`, a plain-text copy of `README.md` with the version and date at the top;
  - `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt`.

The version comes from `package.json`. The build puts it in the page as `__APP_VERSION__` and as a
`<meta name="offline-checkout-version">` tag, which the setup scripts read.

Keep `README.md` to headings, lists, bold, inline code and links. That is all the `README.txt`
conversion handles.

## Icons

The icon sources are in `icons/`:

- `evergreen-tree.svg`: the tree drawing the icons are built from.
- `icon-round.svg`: the main icon with transparent corners. It is the favicon, the logo on the
  launch screen and the main shortcut icon.
- `icon-round-printer.svg`: the same with a printer badge, for the printer setup shortcut. The
  badge is bottom right because Windows draws the shortcut arrow bottom left.
- `icon.svg`: a square, opaque version for the Apple touch icon (iOS and macOS Safari).

After changing one, run `npm run icons` and commit the results. It renders them with
Playwright's Chromium to the shortcut icons (`windows/*.ico`, `macos/*.icns` and `linux/*.png`) and
`icons/apple-touch-icon.png`. The build inlines the favicon and the Apple touch icon into the page
as data URIs, so the single HTML file stays self-contained.

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
- `npm run load-test` builds the app and runs the opt-in load test (`load/sessions.load.ts`, its own
  `playwright.load.config.ts`, so `npm run e2e` never runs it). It takes a few minutes. For each
  scenario (one open session, three open, three open and one closed) it seeds a Chromium profile's
  IndexedDB with logs from three workstations, opens the built file from `file://` and times:
  - the start page: first render, list shown and latest session expanded;
  - `listSessions`' IndexedDB work on its own;
  - resuming a session, opening the summary and each export;
  - for one open session, `since({})` and pairing a new workstation until it has the whole log.

  It prints the median and worst of the runs for each CPU throttle and writes them to
  `test-results/load/*.json`. Settings: `LOAD_RECORDS` (records per session, default 10000),
  `LOAD_RUNS` (default 5) and `LOAD_THROTTLE` (CDP CPU throttle rates, default `1,4`).
  `LOAD_PROFILE=1` also saves CPU profiles of both workstations during pairing as
  `test-results/load/{joiner,inviter}-<rate>x.cpuprofile`, which Chrome DevTools opens. Build with
  `npx vp build --minify false` first to keep function names readable. Throttling
  slows only the page, not the browser's IndexedDB backend or the disk, so it understates an old
  PC with a slow disk.

## Releasing

1. Start from an up-to-date, clean `main`.
2. Run the checks: `npm run check`, `npm test` and `npm run e2e`. All must pass.
3. If anything that touches the scanner, camera or WebRTC has changed, re-run the field probe on real
   library PCs first.
4. Bump the version with `npm version <major|minor|patch>`. This updates `package.json` and
   `package-lock.json`, commits, and creates a `vX.Y.Z` tag. Push both: `git push --follow-tags`.
5. From the tagged commit, run `npm run build && npm run package`, then publish the GitHub release
   with both files:
   `gh release create vX.Y.Z dist/offline-checkout.html dist/offline-checkout-vX.Y.Z.zip`.
6. Open the built file once from `file://` and do a quick check: start a session, scan a patron and
   an item, close the session and generate the PDF.

Sessions live in the browser profile, not the file, so installing a new version keeps them. A release
that changes the IndexedDB schema (`src/store/db.ts`) needs a migration.

## Known limitations

- The field probe must be run on real library PCs before rollout.
- The setup scripts are unsigned. macOS Gatekeeper blocks the downloaded `.command` until staff
  allow it in Privacy & Security (README.md has the steps), and Windows SmartScreen may warn.
- Chrome may ask for camera permission on every pairing when the page is opened from `file://`.
- Chrome has no flag to name a printer. Kiosk printing uses the last printer chosen in that profile,
  which is why there is a printer setup shortcut without `--kiosk-printing`.
- Chrome ignores command-line flags when a window of the same profile is already open, so the
  printer setup window must be closed before opening the everyday shortcut. On macOS Chrome keeps
  running after its last window closes, so each Mac launcher first stops a running instance of the
  profile that has the other `--kiosk-printing` setting.
- Pairing codes carry a format version (`OC3:`). A workstation refuses codes in another format, so
  staff are told to keep every desk on the same release.
- Barcodes are verified by zxing at 300 dpi, but still confirm them with the library's real scanners.

## License

Copyright (C) 2026 Ben Dailey. Offline Checkout is free software under the GNU Affero General Public
License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).

Anyone who distributes a modified version, or lets people use one over a network, must offer them its
source under the same license. Dependencies must stay compatible with the AGPL (MIT, ISC, BSD and
Apache-2.0 are).

The bundled libraries' licenses require their notices to travel with every copy, so the build
collects them. Vite's `build.license` lists each bundled package, and
`scripts/third-party-notices.ts` then:

- fills in any package whose license file Vite missed, failing the build if it finds none;
- adds `licenses/zxing-wasm-native.md` and `licenses/Apache-2.0.txt` for the C++ compiled into
  zxing-wasm's `.wasm`, which npm metadata does not list;
- embeds the result, under the app's own notice, as a comment right after the doctype in the HTML
  (the app and the field probe).

When updating zxing-wasm, check that its README's license list still matches
`licenses/zxing-wasm-native.md`.
