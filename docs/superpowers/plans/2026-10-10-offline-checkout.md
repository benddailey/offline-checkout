# Offline Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single self-contained `offline-checkout.html` that lets 2–5 clerks scan checkouts offline, syncs every record over a WebRTC mesh paired by QR, and prints Code 39 PDFs.

**Architecture:** Pure units (`log/`, `pairing/`, `sync/diff`, `pdf/layout`) carry the logic and are unit-tested in Node; thin effectful units (`store/` IndexedDB, `mesh/` RTCPeerConnection, `pdf/render` jsPDF, `qr/` camera) wrap browser APIs behind injectable interfaces; one Pinia store wires them for Vue screens. Everything is inlined into one HTML file by `vite-plugin-singlefile` so it runs from `file://`.

**Tech Stack:** Vue 3.5, Pinia 3, Tailwind CSS 4 (`@tailwindcss/vite`), TypeScript, Vite+ 1.1.0 (`vp`), vite-plugin-singlefile 2, vue-qrcode-reader 5.7 (zxing-wasm reader inlined), qrcode 1.5, jsPDF 4, JsBarcode 3.12, idb 8, fake-indexeddb (tests), Playwright 1.64 (headed E2E), pdfjs-dist + zxing-wasm (E2E PDF verification).

**Spec:** `docs/superpowers/specs/2026-10-10-offline-checkout-design.md`

## Global Constraints

- Build output: one file `dist/offline-checkout.html`, all JS/CSS/WASM inlined; no dynamic `import()`, no workers, no network fetches at runtime (spec §2).
- Must run from `file://` in Chromium (Chrome, Edge). No admin, no installs.
- `RTCPeerConnection` always created with `{ iceServers: [] }`.
- Code 39 charset: `0-9 A-Z - . space $ / + %`. Control codes `OC-END`, `OC-VOIDLAST` are never stored as patron/item barcodes.
- Code 39 rendering: narrow bar ≥ 7.5 mil (0.0075 in), wide:narrow 3:1, quiet zone ≥ 10× narrow each side.
- PDF: US Letter portrait, 0.5" margins; header with session name, date, "Page X of Y".
- Offers are single-use and expire after 5 minutes. Sync vector exchange every 10 seconds and on connect.
- Records are never edited or deleted; record ID = `deviceId:seq`; `at` is display-only and never used to resolve conflicts (display/PDF order uses `at` with `deviceId`,`seq` tiebreak).
- Tooling: `npx vp test run` (unit), `npx vp check` (fmt+lint+types), `npx vp build`, `npx playwright test` (E2E, **headed** — `DISPLAY` is set). Remove the `devEngines` block the scaffold writes into `package.json` (it pins npm 12.2.0 and breaks `npx`). Unit tests import from `vite-plus/test`.
- Every commit must pass `npx vp check` and `npx vp test run`.

## Review Focus

1. **Same session open in two tabs on one machine** — both would share `deviceId` and collide on `seq`; expected: the second tab refuses with "This session is already open in another tab" (Web Locks). Test in Task 3.
2. **Scanner input with Caps Lock on or stray whitespace** (`" 3120400123  "`, `"abc-1"`) — expected: trimmed and upper-cased before validation, never rejected for case. Test in Task 2.
3. **Scans arriving faster than IndexedDB commits** (scanner bursts) — expected: processed strictly in arrival order, none dropped, none shown before commit. Test in Task 11.
4. **Same item on the same patron via two visits or two machines concurrently** — expected: scan-time warning "already on this patron" and not added locally; PDF block never lists an item twice. Tests in Tasks 2 and 9.
5. **Wrong or damaged pairing payload** (answer pasted where an offer is expected, text with line breaks/whitespace from copy-paste, truncated text, offer from a different session during re-pair) — expected: a clear message and "Try again", never an exception. Test in Task 4.

---

## File Structure

```
index.html → renamed offline-checkout.html (Vite input)
vite.config.ts            vp config: vue, tailwind, singlefile, test include
playwright.config.ts      headed chromium, file:// against dist
src/main.ts, src/App.vue, src/style.css
src/log/types.ts          record envelope + bodies, SessionState types
src/log/ids.ts            randomId(), recordId(), parseRecordId()
src/log/barcode.ts        normalizeScan(), validateBarcode(), CONTROL codes
src/log/reduce.ts         reduce(records) → SessionState
src/log/duplicates.ts     checkItem(state, visitId, barcode)
src/log/vector.ts         vectorOf(records), missingFor(records, vector)
src/store/db.ts           openSessionStore, createSession, listSessions, getDeviceId, acquireSessionLock
src/pairing/sdp.ts        minifySdp(), rebuildSdp()
src/pairing/payload.ts    encodePayload(), decodePayload(), PairingError
src/qr/zxing.ts           inlined wasm override (side-effect module)
src/qr/QrDisplay.vue, src/qr/QrScan.vue   show QR + copy text / camera + paste
src/mesh/protocol.ts      wire message types
src/mesh/mesh.ts          Mesh class
src/mesh/fake-rtc.ts      in-memory RTCPeerConnection for tests
src/sync/sync.ts          SyncEngine
src/pdf/code39.ts         code39Modules(), code39Width()
src/pdf/blocks.ts         blocksFromState()
src/pdf/layout.ts         layout()
src/pdf/render.ts         renderSessionPdf(), renderScannerCard(), downloadBlob()
src/ui/session.ts         Pinia store useSession
src/ui/screens/*.vue      LaunchScreen, PairScreen, ScanScreen, SummaryScreen
src/ui/components/*.vue   StatusBar, FatalAlert, ScanInput
probe/probe.html + probe/main.ts   field probe (§5.5), separate single-file build
e2e/*.spec.ts, e2e/helpers/*.ts
```

---

### Task 1: Project scaffold, single-file build, headed E2E harness

**Files:**
- Create: whole scaffold via `vp create`, then `vite.config.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `src/App.vue` (placeholder "Offline Checkout" heading), `.gitignore` (node_modules, dist, test-results, playwright-report)

**Interfaces:**
- Produces: npm scripts `build` (`vp build`), `test` (`vp test run`), `check` (`vp check`), `e2e` (`vp build && playwright test`); `e2e/helpers/app.ts` exporting `appUrl(): string` (= `file://<abs>/dist/offline-checkout.html`) and `launchChromium(extraArgs?: string[]): Promise<Browser>` (headed, args `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--disable-features=WebRtcHideLocalIpsWithMdns`).

- [ ] **Step 1: Scaffold in repo root without clobbering `docs/`**

Run in a temp dir: `npx -y vite-plus@1.1.0 create vite --no-agent --no-editor --no-git --no-hooks --package-manager npm --no-interactive -- app --template vue-ts`, then move its contents into the repo root. Delete `devEngines` from `package.json`. Remove the demo `HelloWorld` component and assets. Rename `index.html` → `offline-checkout.html` and set `build.rollupOptions.input` to it so the output is `dist/offline-checkout.html`.

- [ ] **Step 2: Install deps**

`npm i vue pinia idb qrcode jspdf jsbarcode vue-qrcode-reader` and `npm i -D tailwindcss @tailwindcss/vite vite-plugin-singlefile fake-indexeddb @playwright/test @types/qrcode pdfjs-dist zxing-wasm`. Run `npx playwright install chromium` if `npx playwright test` reports a missing browser.

- [ ] **Step 3: Configure** `vite.config.ts`: keep the scaffold's `fmt`/`lint` blocks, plugins `[vue(), tailwindcss(), viteSingleFile()]` via `lazyPlugins`, `build.assetsInlineLimit: () => true`, `test.include: ["src/**/*.test.ts"]`, `test.environment: "node"`. `src/style.css` = `@import "tailwindcss";`. `playwright.config.ts`: `testDir: "e2e"`, `use: { headless: false, browserName: "chromium", launchOptions: { args: [same three flags] } }`, `workers: 1`, `timeout: 60_000`.

- [ ] **Step 4: Write `e2e/smoke.spec.ts`**

```ts
test("built file opens from file:// with no network requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  await page.goto(appUrl());
  await expect(page.getByRole("heading", { name: "Offline Checkout" })).toBeVisible();
  expect(external).toEqual([]);
});
```

- [ ] **Step 5: Verify** `npx vp check && npx vp build && ls dist` → only `offline-checkout.html` plus copied `public/` files (delete `public/` demo icons so dist is exactly one file). `npx playwright test e2e/smoke.spec.ts` → 1 passed, a Chromium window visibly opens.

- [ ] **Step 6: Commit** `git add -A && git commit -m "chore: scaffold Vite+ Vue app with single-file build and headed e2e"`

---

### Task 2: `log/` — records, barcode rules, reduce, duplicates, vectors

**Files:**
- Create: `src/log/{types,ids,barcode,reduce,duplicates,vector}.ts`
- Test: `src/log/{barcode,reduce,duplicates,vector}.test.ts`

**Interfaces:**
- Produces (exact):

```ts
// types.ts
export type RecordId = string; // `${deviceId}:${seq}`
export interface Envelope { sessionId: string; deviceId: string; seq: number; employee: string; at: number }
export type RecordBody =
  | { type: "session-created"; name: string }
  | { type: "patron-started"; patron: string }
  | { type: "item-scanned"; visitId: RecordId; item: string }
  | { type: "patron-ended"; visitId: RecordId }
  | { type: "voided"; target: RecordId }
  | { type: "session-closed" };
export type LogRecord = Envelope & RecordBody;
export interface ItemState { id: RecordId; barcode: string; visitId: RecordId; voided: boolean; at: number; employee: string }
export interface VisitState { id: RecordId; patron: string; deviceId: string; employee: string; at: number; ended: boolean; voided: boolean; items: ItemState[] }
export interface SessionState {
  sessionId: string | null; name: string | null; closed: boolean;
  visits: VisitState[];                       // sorted by (at, deviceId, seq)
  patronIndex: Map<string, RecordId[]>;       // patron barcode → visit ids (incl. voided)
  totals: { patrons: number; items: number }; // distinct patrons with ≥1 non-voided visit; non-voided items in non-voided visits
  perClerk: Record<string, { patrons: number; items: number }>; // non-voided visits / items by employee
}
export type VersionVector = Record<string, number>;
// ids.ts
export function randomId(len?: number /*=10*/): string;       // crypto.getRandomValues, [0-9a-z]
export function recordId(r: Pick<Envelope, "deviceId" | "seq">): RecordId;
// barcode.ts
export const CONTROL = { END: "OC-END", VOIDLAST: "OC-VOIDLAST" } as const;
export function normalizeScan(raw: string): string;           // trim + toUpperCase
export type BarcodeCheck = { ok: true } | { ok: false; reason: string };
export function validateBarcode(code: string): BarcodeCheck;  // empty, bad chars (name them), or reserved
// reduce.ts
export function reduce(records: Iterable<LogRecord>): SessionState;
// duplicates.ts
export type ItemCheck = { kind: "ok" } | { kind: "dup-this-patron" } | { kind: "dup-other-patron"; patrons: string[] };
export function checkItem(state: SessionState, visitId: RecordId, item: string): ItemCheck;
// vector.ts
export function vectorOf(records: Iterable<Pick<Envelope, "deviceId" | "seq">>): VersionVector; // highest contiguous seq from 1
export function missingFor<T extends Envelope>(records: Iterable<T>, theirs: VersionVector): T[]; // seq > theirs[deviceId] ?? 0, sorted by deviceId, seq
```

- [ ] **Step 1: Write failing tests** (a `mk(deviceId, seq, body, at?)` helper in the test file):
  - `barcode.test.ts`: `normalizeScan(" 31204abc \n") === "31204ABC"`; `validateBarcode("31204001234567")` ok; `"A-1 . $/+%"` ok; `"AB_1"` fails with reason containing `"_"`; `""` fails; `"OC-END"` and `"OC-VOIDLAST"` fail with reason containing "reserved".
  - `reduce.test.ts`: visit with 2 items → `totals {patrons:1, items:2}`; voiding an item marks `voided:true`, keeps it in `items`, totals items 1; voiding a `patron-started` marks visit and all its items voided, totals 0/0; two visits for same patron → `patronIndex.get(p).length === 2`, `totals.patrons === 1`; `session-closed` sets `closed`; `session-created` sets `name`; **arrival-order independence**: for 20 random shuffles of a 12-record log (incl. a void arriving before its target), `JSON.stringify` of state (maps converted) is identical; items referencing an unknown visit are kept pending and attach once the visit arrives; `perClerk` counts by employee.
  - `duplicates.test.ts`: item on current visit → `dup-this-patron`; item on an earlier non-voided visit of the same patron → `dup-this-patron`; item on another patron's visit → `dup-other-patron` with `patrons:["P2"]`; item only on voided visit or voided item → `ok`.
  - `vector.test.ts`: seqs `a:1,2,3,5` → `{a:3}`; `missingFor` with `{a:2}` returns a:3 and a:5 and all of device b.

- [ ] **Step 2:** `npx vp test run src/log` → FAIL (modules missing).
- [ ] **Step 3:** Implement. `reduce` collects records into maps keyed by record id first, then builds state, so order never matters.
- [ ] **Step 4:** `npx vp test run src/log` → all PASS; `npx vp check` clean.
- [ ] **Step 5: Commit** `feat(log): record types, reduce, duplicate and barcode rules`

---

### Task 3: `store/` — IndexedDB persistence and tab lock

**Files:**
- Create: `src/store/db.ts`
- Test: `src/store/db.test.ts` (first line `import "fake-indexeddb/auto";`)

**Interfaces:**
- Consumes: `LogRecord`, `RecordBody`, `VersionVector`, `vectorOf`, `missingFor`, `randomId` from Task 2.
- Produces:

```ts
export interface SessionMeta { sessionId: string; name: string; deviceId: string; employee: string; nextSeq: number; createdAt: number }
export interface SessionSummary { sessionId: string; name: string; employee: string; createdAt: number }
export interface SessionStore {
  readonly sessionId: string;
  meta(): Promise<SessionMeta>;
  setEmployee(name: string): Promise<void>;
  append(body: RecordBody): Promise<LogRecord>;     // one readwrite tx over [records, meta]: seq = nextSeq, nextSeq++
  put(records: LogRecord[]): Promise<LogRecord[]>;  // ignores existing keys and foreign sessionId; returns newly stored
  all(): Promise<LogRecord[]>;
  since(theirs: VersionVector): Promise<LogRecord[]>;
  vector(): Promise<VersionVector>;
  close(): void;
}
export function getDeviceId(): Promise<string>;      // stored once in index DB "offline-checkout" store "device"
export function createSession(o: { sessionId?: string; name: string; employee: string; withCreatedRecord: boolean }): Promise<SessionStore>;
export function openSessionStore(sessionId: string): Promise<SessionStore>;  // throws if unknown
export function listSessions(): Promise<SessionSummary[]>;                  // newest first
export function acquireSessionLock(sessionId: string): Promise<null | (() => void)>; // navigator.locks ifAvailable; null = held elsewhere
export function requestPersistence(): Promise<boolean>;                     // navigator.storage.persist(), false if unavailable
```

Session DB name `oc-session-<sessionId>`, stores `records` (keyPath `["deviceId","seq"]`) and `meta` (single key `"meta"`). Index DB `offline-checkout` stores `device` and `sessions` (keyPath `sessionId`). Joiners call `createSession({ sessionId: <from offer>, withCreatedRecord: false })`.

- [ ] **Step 1: Write failing tests:** append assigns seq 1,2,3 with this device's id and employee; reopening the store continues at 4; `put` of a duplicate returns `[]`, of a foreign `sessionId` returns `[]`; `since({[dev]:2})` returns only seq 3; `vector()` after putting remote `x:1, x:3` → `{x:1, [dev]:3}`; `listSessions` returns both of two created sessions newest first; `getDeviceId()` stable across calls; `acquireSessionLock` (stub `navigator.locks` with an in-memory implementation in the test) returns a release fn first, `null` second while held, and a fn again after release.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement with `idb`. **Step 4:** `npx vp test run src/store` → PASS.
- [ ] **Step 5: Commit** `feat(store): IndexedDB session store with tab lock`

---

### Task 4: `pairing/` — SDP minify/rebuild and QR payload

**Files:**
- Create: `src/pairing/sdp.ts`, `src/pairing/payload.ts`, `src/pairing/fixtures/*.sdp`, `scripts/capture-sdp.ts`
- Test: `src/pairing/sdp.test.ts`, `src/pairing/payload.test.ts`, `e2e/pairing-roundtrip.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface SdpParts { ufrag: string; pwd: string; fingerprint: string /* "AB:CD:…" sha-256 */; candidates: { address: string; port: number }[] }
export function minifySdp(sdp: string): SdpParts;   // keep udp host candidates only (IP or *.local)
export function rebuildSdp(p: SdpParts, role: "offer" | "answer"): string; // setup:actpass for offer, setup:active for answer
export interface PairingPayload { kind: "offer" | "answer"; sessionId: string; sessionName: string; deviceId: string; employee: string; sdp: SdpParts }
export function encodePayload(p: PairingPayload): string;  // "OC1:" + base64url(JSON array form); fingerprint stored as base64 of 32 bytes
export function decodePayload(text: string, expect: "offer" | "answer"): PairingPayload; // strips all whitespace first
export class PairingError extends Error { code: "malformed" | "wrong-kind" | "wrong-session" | "expired" }
```

Rebuilt SDP template (data channel only; one line per `a=candidate:` with `udp 2113937151 <addr> <port> typ host`):
```
v=0 / o=- <random 16 digits> 2 IN IP4 127.0.0.1 / s=- / t=0 0 / a=group:BUNDLE 0 / a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel / c=IN IP4 0.0.0.0 / <candidates>
a=ice-ufrag / a=ice-pwd / a=ice-options:trickle / a=fingerprint:sha-256 <fp> / a=setup:<role> / a=mid:0 / a=sctp-port:5000 / a=max-message-size:262144
```

- [ ] **Step 1: Capture real Chromium SDP samples.** `scripts/capture-sdp.ts` (run with `node --experimental-strip-types`) launches headless Playwright Chromium twice (with and without `--disable-features=WebRtcHideLocalIpsWithMdns`), creates offer+answer with a data channel and `iceServers: []`, waits for `iceGatheringState === "complete"`, writes `fixtures/{offer,answer}-{ip,mdns}.sdp`. Commit fixtures.
- [ ] **Step 2: Write failing unit tests:** each fixture → `minifySdp` gives non-empty ufrag/pwd, 95-char fingerprint, ≥1 candidate (mdns fixture addresses end `.local`); `minifySdp(rebuildSdp(parts, role))` deep-equals `parts`; offer payload `encodePayload` length ≤ 260 chars with a 10-char session name; `decodePayload(encode(p), "offer")` deep-equals `p`; decode with inserted `"\n  "` still works; decoding an answer with `expect:"offer"` throws `PairingError` code `wrong-kind`; `"hello"`, `"OC1:abc"`, and a truncated payload throw code `malformed` (never a raw `SyntaxError`).
- [ ] **Step 3:** run → FAIL. **Step 4:** implement. **Step 5:** `npx vp test run src/pairing` → PASS.
- [ ] **Step 6: Real-browser round-trip E2E** `e2e/pairing-roundtrip.spec.ts`: in two pages, offer → minify → encode → decode → rebuild → `setRemoteDescription` on the other page, answer back the same way; data channel opens and a "ping" message arrives. (Inject the bundled pairing module via `page.addScriptTag` from a small Vite lib build, or `page.evaluate` with the functions' source — implementer's choice.) `npx playwright test e2e/pairing-roundtrip.spec.ts` → PASS.
- [ ] **Step 7: Commit** `feat(pairing): SDP minify/rebuild and QR payload codec`

---

### Task 5: `qr/` — inlined QR decoder, QR display, scan-or-paste components

**Files:**
- Create: `src/qr/zxing.ts`, `src/qr/QrDisplay.vue`, `src/qr/QrScan.vue`
- Test: `e2e/qr-camera.spec.ts`, `e2e/helpers/y4m.ts`

**Interfaces:**
- Produces: `<QrDisplay :text="string" :label="string" />` (renders QR via `qrcode.toDataURL`, error correction `M`, plus a read-only textarea with the text and a **Copy** button). `<QrScan @decoded="(text: string) => void" />` (camera via `QrcodeStream` from vue-qrcode-reader with `:formats="['qr_code']"`; on camera error shows "Camera unavailable — ask IT nothing; click Allow in the address bar, or paste the code below"; always shows a textarea + **Use pasted code** button that emits `decoded`). `src/qr/zxing.ts` is imported once from `main.ts`: imports the reader wasm as inline base64 (`zxing-wasm/reader/zxing_reader.wasm?inline` or equivalent that Vite inlines), decodes to `Uint8Array`, and calls `setZXingModuleOverrides({ wasmBinary, locateFile: (p, prefix) => (p.endsWith(".wasm") ? "data:," : prefix + p) })`.
- `e2e/helpers/y4m.ts`: `writeQrY4m(text: string, path: string): void` — builds the QR module matrix with `QRCode.create(text)`, scales to 640×480 (white quiet zone), writes YUV4MPEG2 `C420jpeg` with 30 identical frames (Y=0/255, U=V=128).

- [ ] **Step 1: Write failing E2E** `qr-camera.spec.ts`: test via a tiny `e2e/fixtures/qr-harness.html` built by an extra Vite input that mounts `QrScan` and writes decoded text into `#out`. Launch Chromium with `--use-file-for-fake-video-capture=<tmp>.y4m` encoding `"OC1:hello-qr"`; open harness via `file://`; expect `#out` to have text `OC1:hello-qr` within 15 s, and zero non-file/data requests (proves WASM is inlined). Second test: paste path emits text without camera.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vp build` then `npx playwright test e2e/qr-camera.spec.ts` → PASS headed (camera preview visible).
- [ ] **Step 5: Commit** `feat(qr): inlined zxing decoder with camera and paste fallback`

---

### Task 6: Field probe page (§5.5)

**Files:**
- Create: `probe/probe.html`, `probe/main.ts`, `vite.probe.config.ts`, `docs/field-probe.md`
- Test: `e2e/probe.spec.ts`

**Interfaces:**
- Consumes: `minifySdp`, `rebuildSdp`, `encodePayload`/`decodePayload` (Task 4), `QrDisplay`, `QrScan` (Task 5).
- Produces: `dist-probe/probe.html` (single file, `npm run build:probe`). Page shows three checks with PASS/FAIL: (1) **IndexedDB** write/read/delete of a test DB; (2) **Webcam** opens (`getUserMedia`) and decodes a QR; (3) **WebRTC** — "Host" creates offer QR, "Guest" scans/pastes and returns answer QR, data channel ping/pong round-trip time shown. Displays `navigator.userAgent`, `isSecureContext`, candidate types gathered. `docs/field-probe.md`: one-page instructions for running it on two front-desk PCs and what each result means (per spec §5.5 fallbacks).

- [ ] **Step 1: Failing E2E:** two headed pages open `dist-probe/probe.html`; IndexedDB check shows PASS; WebRTC check completes via paste between pages and shows PASS with an RTT number.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm run build:probe && npx playwright test e2e/probe.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(probe): field probe page for firewall/camera/file:// checks`

---

### Task 7: `mesh/` — peer connections, introductions, relay, reconnection

**Files:**
- Create: `src/mesh/protocol.ts`, `src/mesh/mesh.ts`, `src/mesh/fake-rtc.ts`
- Test: `src/mesh/mesh.test.ts`

**Interfaces:**
- Consumes: Task 4 pairing API.
- Produces:

```ts
export interface PeerInfo { deviceId: string; employee: string; connected: boolean }
export type RtcFactory = (config: RTCConfiguration) => RTCPeerConnection;
export interface MeshOptions { sessionId: string; sessionName: string; deviceId: string; employee: string; rtc?: RtcFactory; knownDevices: () => Set<string>; offerTtlMs?: number /*300_000*/; retryMs?: number /*10_000*/; now?: () => number }
export interface Invite { payload: string; expiresAt: number; accept(answerText: string): Promise<PeerInfo>; cancel(): void }
export class Mesh {
  constructor(o: MeshOptions);
  createInvite(): Promise<Invite>;            // waits for ICE gathering complete; accept throws PairingError("expired") after TTL or second use
  static join(offerText: string, o: Omit<MeshOptions, "sessionId" | "sessionName">): Promise<{ mesh: Mesh; offer: PairingPayload; answer: string; connected: Promise<PeerInfo> }>;
  send(peerId: string, msg: unknown): void;
  broadcast(msg: unknown): void;
  onMessage(cb: (peerId: string, msg: unknown) => void): () => void;
  onPeerChange(cb: (peers: PeerInfo[]) => void): () => void;
  peers(): PeerInfo[];
  setEmployee(name: string): void;
  close(): void;
}
```

Wire protocol in `protocol.ts` (JSON over one ordered reliable data channel labelled `oc`): `hello {sessionId, deviceId, employee}` sent on open — mismatched `sessionId` closes the link; `intro {deviceId, employee}` — inviter sends to all other peers after a newcomer's hello; `signal {from, to, id, kind:"offer"|"answer", sdp}` — forwarded one hop if `to` is not self; `app {body}` — delivered to `onMessage`. Offer direction: on `intro`, the existing peer offers to the newcomer; on reconnection, the lexicographically lower `deviceId` offers, sending the `signal` to every connected peer (whoever is linked to the target forwards; target ignores duplicate `id`s), retried every `retryMs` while disconnected and only for ids in `knownDevices()`. A peer that was seen stays in `peers()` with `connected:false`.

`fake-rtc.ts`: `createFakeRtcNetwork(): RtcFactory` — fake `RTCPeerConnection` (createOffer/createAnswer return `rebuildSdp` output with unique ufrag; `setRemoteDescription(answer)` links the two fakes by ufrag; data channels deliver via `queueMicrotask`; `iceGatheringState` becomes `"complete"` immediately) plus `network.cut(a, b)` to drop a link (fires `close` on both channels).

- [ ] **Step 1: Failing tests** (fake RTC + fake timers where needed): A invites, B joins with pasted text, `connected` resolves with A's info and both `peers()` list each other connected; `app` message A→B delivered; C joins via A → within a tick B and C are connected directly (full mesh, no extra pairing), `peers()` on each has 2 connected; `cut(B,C)` → after `retryMs` B–C reconnect via A; `cut` all of C's links → C's peers become `connected:false` and stay so (no common peer); invite accepted after `offerTtlMs` → throws `expired`; same invite accepted twice → second throws `expired`; peer with different `sessionId` in hello is dropped; device not in `knownDevices()` is never auto-dialed.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vp test run src/mesh` → PASS.
- [ ] **Step 5: Commit** `feat(mesh): QR-paired WebRTC mesh with introductions and reconnection`

---

### Task 8: `sync/` — version-vector catch-up and live push

**Files:**
- Create: `src/sync/sync.ts`
- Test: `src/sync/sync.test.ts`, `src/sync/sim.test.ts`

**Interfaces:**
- Consumes: `vectorOf`, `missingFor` (Task 2); `SessionStore` (`put`, `since`, `vector`) (Task 3); `Mesh` methods `send`, `broadcast`, `onMessage`, `onPeerChange`, `peers` (Task 7).
- Produces:

```ts
export type MeshLike = Pick<Mesh, "send" | "broadcast" | "onMessage" | "onPeerChange" | "peers">;
export type StoreLike = Pick<SessionStore, "put" | "since" | "vector" | "sessionId">;
export class SyncEngine {
  constructor(o: { mesh: MeshLike; store: StoreLike; onRecords: (fresh: LogRecord[]) => void; intervalMs?: number /*10_000*/; batch?: number /*200*/ });
  start(): void; stop(): void;
  pushLocal(r: LogRecord): void;   // broadcast immediately
}
```
App messages: `{ t: "vec", vector }` → reply `{ t: "recs", records: since(vector) }` chunked by `batch`; `{ t: "recs", records }` → `store.put` (store drops foreign sessions), `onRecords(fresh)` if non-empty. Send own `vec` to a peer when it becomes connected and to all every `intervalMs`.

- [ ] **Step 1: Failing tests.** `sync.test.ts`: a `vec` from a peer missing seq 2–3 gets exactly those back; records with another `sessionId` are not passed to `onRecords`; duplicate `recs` call `onRecords` once. `sim.test.ts`: three engines with in-memory stores (simple `Map` implementing `StoreLike`) over a `FakeMeshNetwork` (test-local) supporting link up/down, random reordering and duplication of deliveries (seeded RNG); script: each node appends 30 records interleaved with link drops (A–C down, then B isolated, then all up), advance fake timers by 30 s → all three stores have identical record sets (90) and `reduce` states equal; run with 5 seeds.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vp test run src/sync` → PASS.
- [ ] **Step 5: Commit** `feat(sync): version-vector sync with simulation tests`

---

### Task 9: `pdf/` — Code 39 geometry, blocks, pure layout

**Files:**
- Create: `src/pdf/code39.ts`, `src/pdf/blocks.ts`, `src/pdf/layout.ts`
- Test: `src/pdf/{code39,blocks,layout}.test.ts`

**Interfaces:**
- Consumes: `SessionState` (Task 2).
- Produces:

```ts
export const NARROW_IN = 0.0075, QUIET_MODULES = 10;
export function code39Modules(text: string): string;   // "1"/"0" bars via JsBarcode encoder (format CODE39, mod43 off), includes start/stop *
export function code39Width(text: string): number;     // inches incl. quiet zones = (modules + 2*QUIET_MODULES) * NARROW_IN
export interface Block { patron: string; items: string[]; clerks: string[]; firstAt: number }
export function blocksFromState(s: SessionState): Block[]; // merge non-voided visits per patron, drop voided items, dedupe items (first occurrence wins), omit patrons with no non-voided visit, sort by firstAt then patron
export const GEOMETRY = { pageW: 8.5, pageH: 11, margin: 0.5, headerH: 0.45, gutter: 0.25, barH: 0.25, textH: 0.13, patronRowH: 0.55, itemRowH: 0.36, captionH: 0.2, boxPad: 0.08, blockGap: 0.15 } as const;
export type Placed =
  | { kind: "page-header"; page: number; text: string }               // renderer adds "Page X of Y"
  | { kind: "barcode"; page: number; x: number; y: number; text: string; role: "patron" | "item"; continued?: boolean }
  | { kind: "box"; page: number; x: number; y: number; w: number; h: number }
  | { kind: "caption"; page: number; x: number; y: number; text: string }
  | { kind: "summary"; page: number; x: number; y: number; lines: string[] };
export function layout(blocks: Block[], summaryLines: string[], g?: typeof GEOMETRY): { columns: number; colW: number; pages: number; elements: Placed[] };
```
Column count = `max(1, floor((usableW + gutter) / (maxCode39Width + gutter)))` over all patron and item barcodes. Blocks flow down a column, then next column, then next page; a block that doesn't fit the remaining column moves whole; a block taller than a full column fills columns and repeats the patron barcode with `continued: true` at each continuation. Summary goes after the last block (new column/page if it doesn't fit).

- [ ] **Step 1: Failing tests:** `code39Modules("A")` length = 3×16−1 = 47 and starts with the `*` pattern; `code39Width("31204001234567")` ≈ 2.06 in (±0.01); `blocksFromState`: two visits for P1 with overlapping item → one block, item once; fully voided patron omitted; layout: twenty 14-digit blocks → `columns === 3`; any 20-char barcode present → `columns === 2`; no barcode element lies outside `[margin, pageW−margin] × [margin+headerH, pageH−margin]`; no block's elements span two columns unless it is taller than a column; a 60-item block produces ≥2 patron barcodes with `continued:true` on the later ones and every item appears exactly once; 0 blocks → `pages === 1` with summary only.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (`code39Modules` uses `JsBarcode(obj, text, { format: "CODE39" })` on a plain object target and reads `obj.encodings`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pdf): Code 39 geometry, patron blocks and pure page layout`

---

### Task 10: `pdf/render` — jsPDF renderer and scanner card

**Files:**
- Create: `src/pdf/render.ts`
- Test: `src/pdf/render.test.ts`

**Interfaces:**
- Consumes: Task 9 API.
- Produces: `renderSessionPdf(state: SessionState, opts: { date: Date }): Blob`; `renderScannerCard(): Blob` (Letter page, title "Offline Checkout — Scanner card", large Code 39 for `OC-END` labelled "End patron" and `OC-VOIDLAST` labelled "Void last item", narrow bar 0.015 in); `downloadBlob(blob: Blob, filename: string): void` (anchor + `URL.createObjectURL`). Barcodes are drawn as vector `rect`s from `code39Modules` at `NARROW_IN`, bar height `barH`, human-readable text centered below in 8 pt Courier; header text "<session name> — <YYYY-MM-DD> — Page X of Y"; summary lines "Patrons: N", "Items: N", then "<clerk>: N patrons, N items" each.

- [ ] **Step 1: Failing test** (Node; jsPDF works headless): render a 3-patron state with `compress: false`, decode output text: contains each patron and item human-readable string exactly once per occurrence and `"Page 1 of 1"`; rect count for barcode "A" equals the number of `1`-runs in `code39Modules("A")`. Scanner card text contains `OC-END` and `OC-VOIDLAST`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pdf): vector Code 39 PDF renderer and scanner card`

---

### Task 11: `ui/session.ts` Pinia store + Launch and Scan screens

**Files:**
- Create: `src/ui/session.ts`, `src/ui/screens/LaunchScreen.vue`, `src/ui/screens/ScanScreen.vue`, `src/ui/components/{ScanInput,StatusBar,FatalAlert}.vue`; Modify: `src/App.vue`, `src/main.ts`
- Test: `src/ui/session.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 7, 8, 10.
- Produces (`useSession` Pinia setup store; later tasks read/call these):

```ts
state: screen: "launch" | "pair-invite" | "pair-join" | "scan" | "summary"; meta: SessionMeta | null; records: LogRecord[]; currentVisitId: RecordId | null;
       message: { tone: "info" | "warn" | "error"; text: string } | null; fatal: string | null; peers: PeerInfo[]; isolated: boolean
getters: state (= reduce(records)), currentVisit: VisitState | null, closed: boolean
actions: startSession(name: string, employee: string), resumeSession(sessionId: string), scan(raw: string): Promise<void>,
         voidRecord(id: RecordId), endPatron(), voidPatron(), closeSession(), generatePdf(), printScannerCard(),
         attachMesh(mesh: Mesh) /* starts SyncEngine, mirrors peers */, adoptJoinedSession(offer: PairingPayload, employee: string, mesh: Mesh)
deps injection: createSessionStoreDeps({ store module functions, now }) so tests pass fakes
```
`scan` behaviour: queue scans and process one at a time (a promise chain) in arrival order; `normalizeScan` → if closed: error "Session closed"; `OC-END` → `patron-ended` (no-op with info if no visit); `OC-VOIDLAST` → void last non-voided item of current visit (info "Nothing to void" otherwise); no current visit → validate → `patron-started`, set current; else validate → `checkItem`: `dup-this-patron` → warn "Already on this patron — not added", `dup-other-patron` → append + warn "Also on patron <barcodes>", ok → append. Records join `records` only after `append` resolves. Any append rejection → `fatal = "Could not save the scan … Do not continue scanning on this workstation."` On resume, `currentVisitId` = this device's latest visit that is neither ended nor voided. Remote records arriving via sync are merged into `records`. `requestPersistence()` is called on start/resume/join. Session lock held for the store's lifetime; `resumeSession`/`startSession` set `fatal` "This session is already open in another tab" if `acquireSessionLock` returns `null`.

Screens: **Launch** — Start new session (name defaults to today `YYYY-MM-DD`, clerk name required; after start offer "Print scanner card"), Join session (→ `pair-join`), Resume list from `listSessions()`. **Scan** — `ScanInput` is an always-focused text input (refocus on `blur` and on document click) that calls `scan(value)` on Enter; large "Scan patron card" prompt when no visit; otherwise patron barcode large, item list with **Void** buttons and strikethrough for voided, **End patron**, **Void patron**; message banner; "Session closed" banner when closed. **StatusBar** (always visible on scan/summary): each peer name with green/red dot, "Disconnected — re-pair with any workstation" when `isolated`, totals "Patrons N · Items N", buttons **Add workstation**, **Summary**. **FatalAlert** full-screen red overlay when `fatal`.

- [ ] **Step 1: Failing store tests** (Pinia `createPinia()` + fake deps with an in-memory store whose `append` resolves after a random 0–20 ms delay): 10 scans fired without awaiting → records in exactly that order, first is `patron-started`; `" p1 "` starts patron `P1`; same item twice → second gives warn and only one `item-scanned`; `OC-VOIDLAST` voids last item; `OC-END` clears current visit; scan after `closeSession()` → error message, no record; append rejecting → `fatal` set and no record shown; resume with an open visit restores `currentVisitId`; lock returning `null` sets fatal.
- [ ] **Step 2:** FAIL. **Step 3:** implement store and screens. **Step 4:** `npx vp test run src/ui` PASS; `npx vp check` clean.
- [ ] **Step 5: E2E** `e2e/scan.spec.ts` (single page, headed): start session, scan patron and two items with `page.keyboard.type("…\n")`, click elsewhere then type again (focus restored), void one item (strikethrough visible), type `OC-END\n` → "Scan patron card" prompt; reload page → Resume list shows the session; resuming shows totals 1/1. PASS.
- [ ] **Step 6: Commit** `feat(ui): session store, launch and scanning screens`

---

### Task 12: Pairing screens and live mesh in the app

**Files:**
- Create: `src/ui/screens/PairScreen.vue`; Modify: `src/ui/session.ts`, `src/ui/components/StatusBar.vue`, `src/App.vue`
- Test: `e2e/pair.spec.ts`, `e2e/helpers/pair.ts`

**Interfaces:**
- Consumes: `Mesh`, `Invite` (Task 7), `QrDisplay`, `QrScan` (Task 5), store actions (Task 11).
- Produces: `PairScreen` in two modes. **Invite** (from Add workstation): shows offer `QrDisplay` with countdown to expiry, then `QrScan` for the answer; on `PairingError` shows message and **Try again** (fresh invite). **Join**: `QrScan` for offer → "Join <session name>?" confirm → clerk name input → creates local session store with offer's `sessionId`, shows answer `QrDisplay`, waits for `connected`, then `screen = "scan"`. Resume on a machine with no live peers sets `isolated = true` and the StatusBar offers **Re-pair** (opens Join mode but accepts only offers with the same `sessionId`; otherwise `PairingError("wrong-session")`). `e2e/helpers/pair.ts`: `pairViaPaste(inviter: Page, joiner: Page, joinerName: string): Promise<void>` using the Copy textareas and paste fields.

- [ ] **Step 1: Failing E2E** `pair.spec.ts`, three browser contexts A, B, C (headed): A starts session "Outage", pairs B then C via paste; within 10 s every StatusBar shows the other two names with green dots (B–C linked via introduction); B scans patron+item → A and C totals show 1/1 within 3 s; pasting an answer into the offer field shows "That is a reply code" style error and **Try again**.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vp build && npx playwright test e2e/pair.spec.ts` PASS.
- [ ] **Step 5: Commit** `feat(ui): QR pairing screens and live mesh status`

---

### Task 13: Summary, close session, PDF generation; full E2E with PDF verification

**Files:**
- Create: `src/ui/screens/SummaryScreen.vue`, `e2e/full-flow.spec.ts`, `e2e/helpers/pdf.ts`
- Modify: `src/ui/session.ts`, `src/App.vue`

**Interfaces:**
- Consumes: everything above.
- Produces: Summary screen: patrons with their items (voided struck through), totals, per-clerk counts, **Generate PDF** (disabled when `totals.patrons === 0`), **Print scanner card**, **Close session** (confirm dialog) → `session-closed` record; when closed every machine shows the banner and rejects scans. PDF filename `offline-checkout-<session name>-<YYYY-MM-DD>.pdf`. `e2e/helpers/pdf.ts`: `pdfText(path): Promise<string>` (pdfjs-dist legacy build) and `decodePdfBarcodes(path): Promise<string[]>` (`pdftoppm -r 300 -png`, then `zxing-wasm/reader` `readBarcodes(blob, { formats: ["Code39"], maxNumberOfSymbols: 255 })` per page).

- [ ] **Step 1: Failing E2E** `full-flow.spec.ts` (two contexts, headed): A starts, prints scanner card (download event fires), pairs B; A scans P1 with items I1, I2 and voids I2; B scans P2 with I3 and I1 (warning names P1 visible); B voids patron P3 after scanning it with I4; A ends patron via `OC-END`; A closes session → B shows "Session closed" and typing a barcode on B shows rejection; B clicks Generate PDF → download saved; `decodePdfBarcodes` equals multiset `{P1, I1, P2, I3, I1}` (no P3, I2, I4); `pdfText` contains "Page 1 of 1", "Patrons: 2", "Items: 3". Also: on a fresh session Generate PDF is disabled.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vp build && npx playwright test` → all E2E PASS headed; `npx vp test run` and `npx vp check` clean.
- [ ] **Step 5: Commit** `feat(ui): session summary, close session and PDF export`

---

### Task 14: Polish pass and README

**Files:**
- Create: `README.md` (what it is, build `npm run build`, how clerks use it, field probe link, test commands); Modify: any screen for Tailwind layout polish (large touch targets ≥ 44 px, readable at 1366×768).

- [ ] **Step 1:** Run the full headed suite and take screenshots of Launch, Pair (invite), Scan, Summary at 1366×768 into `test-results/screens/`; inspect them; fix any layout issue found.
- [ ] **Step 2:** `npx vp check && npx vp test run && npx vp build && npx playwright test` → all green; `ls -la dist` shows one HTML file; `grep -c "https\?://" dist/offline-checkout.html` reviewed — no runtime fetch URLs (library license/comment URLs are acceptable).
- [ ] **Step 3: Commit** `docs: README and UI polish`
