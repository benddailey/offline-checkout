# Offline Checkout — Design

**Date:** 2026-10-10
**Status:** Draft for review

## 1. Purpose

When a public library loses internet, front-desk clerks still need to check out materials. Offline Checkout lets several clerks at different workstations scan patron and item barcodes during the outage, keeps a complete copy of every transaction on every workstation, and produces printable PDFs of Code 39 barcodes that staff scan into the live library system once it is back online.

### Success criteria

- 2–5 clerks scan concurrently with zero internet connectivity.
- Every workstation in a session ends with an identical, complete record of all transactions.
- Any workstation can generate one PDF covering the whole session, with no duplicates and no lost scans.
- The live system's barcode scanners read every barcode on the PDF.

### Constraints

- Workstations run locked-down Windows: no admin rights, no software installs, no IT involvement (no firewall exceptions).
- The app must run in any Chromium-based browser (Chrome, Edge).
- No internet at runtime. The only network traffic is workstation-to-workstation on the local network.
- Barcode scanners are 1D laser/linear USB keyboard-wedge devices (they cannot read QR codes or screens).
- Workstations have USB webcams, used for QR-based pairing.
- Stack: Vue 3, Tailwind CSS, Vite+ (`vp`) for build/test/lint/format, TypeScript.

### Out of scope (for now)

- Validating patron vs. item barcode patterns (the library has a common pattern with exceptions; later task).
- Automatic network discovery of sessions (impossible from a browser; replaced by QR pairing).
- Session passwords (physical QR exchange is the access control; see §5.3).
- Hosted / PWA delivery (the single-file build keeps this option open if `file://` is blocked).

## 2. Delivery

The app is built by `vp build` into a single self-contained `offline-checkout.html` with all JS, CSS, and WASM (QR decoder engine) inlined. Clerks open it from the desktop or a USB stick (`file://`). It never fetches anything from the network.

Implications of `file://` in Chromium:
- Module scripts and separate chunk files are blocked, so everything must be inlined (single-file build plugin; no dynamic imports, no separate workers).
- The QR decoder (`vue-qrcode-reader` → `barcode-detector` → `zxing-wasm`) loads its WASM from a CDN by default. The WASM must be inlined and supplied via the library's module override (`setZXingModuleOverrides`).
- Camera permission is typically not remembered for `file://`; clerks may click Allow each time they pair.
- Browser storage (IndexedDB) persists in the user's browser profile, not alongside the HTML file.

## 3. Architecture

Units, each with one purpose and a narrow interface:

| Unit | Responsibility | Depends on |
|---|---|---|
| `log/` | Record type definitions and IDs; pure `reduce(records) → SessionState` (visits, items, voids, closed flag); duplicate-scan detection; Code 39 charset validation. | — |
| `store/` | IndexedDB persistence: one database per session; append records, read all, read since a vector; session metadata. | `log/` |
| `pairing/` | Create WebRTC offer/answer with `iceServers: []`; minify SDP to a compact payload (~150 bytes) and rebuild full SDP from it; payload ↔ QR string. | — |
| `mesh/` | Own the peer connections: QR pairing handshake, introductions (relayed signaling through existing peers), reconnection, peer status. Exposes `send(peerId, msg)`, `broadcast(msg)`, `onMessage`, `onPeerChange`. Transport is injectable for tests. | `pairing/` |
| `sync/` | Version-vector catch-up protocol and live push of new records. | `mesh/`, `store/` |
| `pdf/` | Pure `layout(blocks, page) → positioned elements`; renderer draws those with jsPDF + JsBarcode (Code 39). Also renders the scanner card. | `log/` |
| `ui/` | Vue 3 + Tailwind screens; one Pinia store wires the units together. | all above |

Pure units (`log/`, `pairing/` minify/rebuild, `sync/` diff logic, `pdf/` layout) are tested without a browser.

## 4. Clerk flow

### 4.1 Launch screen

- **Start new session** — enter session name (default: today's date) and the clerk's name. Offers to print the scanner card (§7.3).
- **Join session** — goes to pairing (§5.1); asks for the clerk's name after the session is identified.
- **Resume** — lists sessions already stored on this machine. Opens the local copy immediately and prompts to re-pair to catch up.

The clerk's name is stored per session on that machine and stamped on every record that machine creates.

### 4.2 Scanning loop

1. **Scan patron.** Large "Scan patron card" prompt. The scanner types the barcode + Enter into an always-focused input (focus is restored if the clerk clicks elsewhere).
2. **Scan items.** The patron barcode is shown large at the top; items are listed below as they are scanned.
   - A scan appears only after it is saved locally.
   - Each item has a **Void** button; voided items remain visible with strikethrough.
   - Item already on this visit → warning, not added.
   - Item already on another patron in the session → added, with a warning naming that patron's barcode.
   - Scanning `OC-VOIDLAST` voids the most recent non-voided item on the current visit.
3. **End patron** — button, or scan `OC-END`. Returns to step 1.

**Void patron** voids the current visit and all its items.

**Always visible:** status bar with each connected workstation (clerk name, green/red dot) and session totals (patrons, items).

### 4.3 Ending a session

- **Session summary** (available any time): all patrons with their items, totals, per-clerk counts, and **Generate PDF**.
- **Close session** writes a `session-closed` record. When received, every machine stops accepting scans; summary and PDF remain available. A visit in progress when the session closes is kept as-is.

## 5. Pairing and connections

### 5.1 Pairing (once per joining machine)

1. On any machine already in the session, a clerk clicks **Add workstation**. It creates an `RTCPeerConnection` with `iceServers: []`, a data channel, and an offer; waits for ICE gathering to finish.
2. The offer is minified to: session ID, session name, inviter device ID, ICE ufrag/pwd, DTLS fingerprint, and host candidates (mDNS `.local` name or IP, port). Encoded as one QR code and shown on screen.
3. The joiner clicks **Join**, scans the QR with the webcam, sees "Join *<session name>*?", confirms, and enters their name.
4. The joiner's screen shows the minified answer as a QR; the inviter scans it. The data channel opens.
5. An offer is single-use and expires after 5 minutes.

Fallback: each QR screen also offers its payload as copyable text, and each scan screen accepts pasted text (for broken/missing cameras and for automated tests).

### 5.2 Introductions and full mesh

After a new peer connects, the inviter tells all its connected peers about the newcomer. Each existing peer creates an offer for the newcomer and relays offer/answer/candidates through the inviter's existing data channels. Result: a full mesh with no further scanning. Suitable for up to ~10 machines.

### 5.3 Access control

No password. Joining requires two clerks physically present: one initiates **Add workstation** and scans the newcomer's screen with their webcam. Offers are single-use and short-lived. Automatic reconnects (§5.4) are only made between device IDs already in the session. WebRTC encrypts all traffic (DTLS).

### 5.4 Reconnection

- **Link lost, both machines still have other links:** they re-signal through any common connected peer automatically.
- **Machine fully isolated** (reload, crash, sleep): shows "Disconnected — re-pair with any workstation." Scanning continues locally; everything syncs after re-pairing via QR.

### 5.5 Known unknowns (verified first)

Before building anything else, a throwaway probe page is run on two real front-desk PCs to verify:
1. WebRTC host-candidate connections succeed through Windows Firewall without exceptions.
2. Whether Chrome's Local Network Access prompt appears for WebRTC, and that allowing it works.
3. `file://` pages can open the webcam, use IndexedDB, and are not blocked by policy.

If (3) fails, fall back to hosted delivery with offline install (PWA). If (1) fails, the browser-only design is not viable and the approach must be revisited.

## 6. Data model and sync

### 6.1 Records

Every record has a common envelope:

| Field | Meaning |
|---|---|
| `sessionId` | Session this record belongs to |
| `deviceId` | Random ID generated once per machine |
| `seq` | Per-device counter: 1, 2, 3… with no gaps |
| `employee` | Clerk name for this machine in this session |
| `at` | Local timestamp — display only, never used for ordering |
| `type` + data | See below |

Record ID = `deviceId:seq`.

| Type | Data |
|---|---|
| `session-created` | session name |
| `patron-started` | patron barcode (starts a visit; visit ID = this record's ID) |
| `item-scanned` | visit ID, item barcode |
| `patron-ended` | visit ID |
| `voided` | target record ID (an `item-scanned` or `patron-started`) |
| `session-closed` | — |

Records are never edited or deleted. Voiding a `patron-started` voids the visit and all its items.

### 6.2 State

`log/reduce(records) → SessionState` is pure and deterministic regardless of record arrival order. It produces visits with their non-voided items, voided markers, patron → visits index, and the closed flag. Duplicate warnings and the PDF read from this state.

### 6.3 Sync protocol

- Each machine's holdings are summarized as a version vector `{deviceId: highestContiguousSeq}`.
- On connect and every 10 seconds, peers exchange vectors; each sends the records the other lacks.
- New local records are pushed to all connected peers immediately.
- Applying a record is idempotent (keyed by `deviceId:seq`); duplicates are ignored.
- Records whose `sessionId` does not match the local session are rejected.
- Records from devices a machine has never connected to arrive transitively.

### 6.4 Storage

One IndexedDB database per session: a `records` store keyed by `[deviceId, seq]`, and a `meta` store (session name, local `deviceId`, local `employee`, next `seq`). The app calls `navigator.storage.persist()`. A scan is shown only after its record is committed.

### 6.5 Barcode rules

Patron and item barcodes must contain only Code 39-encodable characters (`0-9 A-Z - . space $ / + %`); others are rejected at scan time with a message. `OC-END` and `OC-VOIDLAST` are reserved control codes and are never stored as patron or item barcodes.

## 7. PDF output

### 7.1 Layout

- US Letter portrait, 0.5" margins.
- Page header: session name, date, "Page X of Y".
- Final section: totals (patrons, items) and per-clerk counts.
- One **block per patron**, merging all non-voided visits for that barcode, ordered by first scan time. Fully voided patrons are omitted.
- Block: header = patron barcode (Code 39) with human-readable text; a box around that patron's item barcodes, one per row, each with human-readable text; small caption with item count and clerk names.

### 7.2 Barcode sizing and packing

- Code 39, narrow bar ≥ 7.5 mil, wide:narrow ratio 3:1, quiet zone ≥ 10× narrow bar on each side.
- Column count is computed from the widest barcode in the session (typically 3 columns for 14-digit barcodes; 2 if longer barcodes are present).
- Blocks flow down a column, then to the next column, then the next page. A block that does not fit in the remaining column space moves whole to the next column/page.
- Exception: a block taller than a full column (roughly 30+ items) continues into the next column with the patron barcode repeated and marked "(continued)".
- `pdf/layout` is pure: blocks + page geometry → positioned elements. The renderer only draws.

### 7.3 Scanner card

A printable one-page card with Code 39 barcodes for `OC-END` (End patron) and `OC-VOIDLAST` (Void last item), offered at session start and available from the menu.

## 8. Error handling

| Situation | Behavior |
|---|---|
| Camera denied/missing | Message explaining how to allow; paste-text fallback |
| IndexedDB write fails (quota, blocked) | Scan refused; red full-screen alert. Never silently lost. |
| Pairing offer expired / QR undecodable | "Try again" with a fresh offer |
| Barcode has non-Code 39 characters | Rejected with reason |
| Scan after session closed | Rejected; banner "Session closed" |
| Generate PDF with zero patrons | Button disabled |
| Record from a different session | Dropped by sync |

## 9. Testing

- **Unit (Vitest via `vp test`):** `log/reduce` (voids, void-patron, duplicates, visit merging, arrival-order independence); Code 39 validation; `pairing/` minify ↔ rebuild round-trip against real Chromium SDP samples; `sync/` vector diffing; `pdf/layout` (packing, no splitting, continued blocks, column count).
- **Sync simulation:** three in-memory peers over a fake transport with link drops, reconnects, and reordered/duplicated delivery; assert identical record sets and states.
- **End-to-end (Playwright):** two browser contexts pair via paste fallback, scan via simulated keyboard input, void, end patron, close session, generate PDF; assert the PDF contains the expected barcode values.
- **Field probe (§5.5):** run first on real front-desk PCs.

## 10. Technology

Vue 3, Pinia, Tailwind CSS, TypeScript, Vite+ (`vp`) with a single-file output plugin, `vue-qrcode-reader` (with inlined `zxing-wasm`) for webcam QR scanning, `qrcode` for QR rendering, jsPDF + JsBarcode for PDFs, `idb` for IndexedDB, Vitest, Playwright.
