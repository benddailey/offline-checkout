# Delete Closed Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every export in the session log, and let staff delete a closed session from the
Summary page, here and on every connected workstation, behind a slide-to-delete confirmation.

**Architecture:** A new `exported` log record syncs like any other and is reduced into
`SessionState.exports`. Deleting sends two new mesh app messages (`delete-session`, `deleted`)
through the session's existing mesh, then removes the index entry and the session's IndexedDB
database. The slider's logic is a pure module, and a thin Vue component renders it.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Pinia (`useSession`), `idb`, Vitest via
`vite-plus/test` with `fake-indexeddb`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-delete-session-design.md`

## Global Constraints

- Import test APIs from `vite-plus/test`, never `vitest` (lint enforces it).
- No new dependencies.
- Pairing payload unchanged; `OC2:` stays.
- A delete never removes a session that is open (not closed) on the receiving workstation.
- Reply wait: at most 3000 ms (`DELETE_REPLY_MS`).
- Exact copy (the spec's quotes are curly; use them as written):
  - Dialog title: `Delete session`.
  - Dialog body: `This removes the session from this workstation and from all connected workstations. It cannot be undone.`
  - Export line: `<Noun>: downloaded <time> by <clerk> (<workstation>)`, where `(<workstation>)` is
    omitted when empty. Never exported: `No <noun> download recorded`. Nouns: `PDF`, `CSV file`,
    `Excel file`, `Evergreen file`. Capitalise the first letter at the start of a line.
  - Evergreen warning: `Download the Evergreen file first if these checkouts are not in Evergreen yet.`
  - Not connected: `Not connected: <names>. ` then `It keeps its copy.` for one name, or
    `They keep their copies.` for more.
  - Slider label: `Slide to delete`.
  - Notices: `Session ‘<name>’ deleted.` (+ ` Not confirmed on: <names>.`),
    `Session ‘<name>’ was deleted on <workstation>.`, or `… on another workstation.`
- Before the PR: `npx vp check`, `npx vp test run`, `npm run e2e` pass.
- README stays headings, lists, bold, inline code and links.

## Review Focus

1. The same `delete-session` message arrives twice, or after the teardown has started. Expect one
   delete and one notice, and no error. Test in Task 4.
2. Deleting with no connected peers. Expect the delete to happen at once, with no 3 s wait and no
   "Not confirmed" text. Test in Task 4.
3. An export whose download throws. Expect no `exported` record, because the dialog must not claim
   a file that never downloaded. Test in Task 2.
4. `listSessions` runs after a delete. Expect the session not listed and its database not
   re-created. Test in Task 3.
5. A scanner's Enter or Space while the slider has focus. Expect no confirm. Test in Task 5
   (logic) and Task 7 (e2e).

---

### Task 1: `exported` record

**Files:**
- Modify: `src/log/types.ts` (RecordBody, new `ExportKind`, `ExportState`, `SessionState.exports`)
- Modify: `src/log/validate.ts`, `src/log/reduce.ts`
- Modify: `src/pdf/render.test.ts`, and any other `SessionState` literal (grep `perWorkstation: {`).
  Add `exports: []`.
- Test: `src/log/validate.test.ts`, `src/log/reduce.test.ts`

**Interfaces:**
- Produces:
  - `type ExportKind = "pdf" | "csv" | "xlsx" | "xacts"`;
  - RecordBody member `{ type: "exported"; kind: ExportKind }`;
  - `interface ExportState { kind: ExportKind; at: number; employee: string; workstation: string }`
    (`workstation` is `""` when absent);
  - `SessionState.exports: ExportState[]`, in the reducer's sorted record order.

- [ ] **Step 1: Write failing tests.**
  - validate: `isLogRecord` is true for `{...envelope, type: "exported", kind}` for each of the four
    kinds, and false for `kind: "docx"` and for a missing kind.
  - reduce: a log of a session, a visit with one item, `session-closed`, then `exported` `xacts`
    and `exported` `pdf` (second desk, `workstation: "Back"`). Expect `state.exports` to equal
    `[{kind:"xacts", …, workstation:""}, {kind:"pdf", …, workstation:"Back"}]`, and `totals` and
    `closed` to be what they are without the exports.
- [ ] **Step 2: Run** `npx vp test run src/log`. Expect them to FAIL.
- [ ] **Step 3: Implement** the type, the validate case (`kind` one of the four), and the reduce
  case (push to `exports`). Add `exports: []` to the `SessionState` literals.
- [ ] **Step 4: Run** `npx vp test run` and `npx vp check`. Expect both to PASS.
- [ ] **Step 5: Commit** "Add an exported record to the session log".

### Task 2: Record exports

**Files:**
- Modify: `src/ui/session.ts` (`generatePdf`, `exportTable`)
- Test: `src/ui/session.test.ts`

**Interfaces:**
- Consumes: Task 1's `exported` body and `state.exports`.
- Produces: after a successful `deps.downloadBlob`, `generatePdf` and `exportTable(format)` record
  `{ type: "exported", kind }` through `enqueue(() => commit(..., "change"))`.

- [ ] **Step 1: Write failing tests.**
  - On a closed session with one patron, `generatePdf()` then `exportTable("xacts")`, then await the
    queue (as the existing tests do). Expect `s.state.exports.map(e => e.kind)` to equal
    `["pdf", "xacts"]`, each carrying the clerk's name.
  - With `downloadBlob` throwing, `exportTable("csv")` leaves `exports` empty (Review Focus 3).
- [ ] **Step 2: Run** `npx vp test run src/ui/session.test.ts`. Expect them to FAIL.
- [ ] **Step 3: Implement.** Append only after `downloadBlob` returns, inside the existing `try`.
  Both functions stay synchronous: queue the commit, don't await it.
- [ ] **Step 4: Run** the tests. Expect them to PASS.
- [ ] **Step 5: Commit** "Record each export in the session log".

### Task 3: `db.deleteSession`

**Files:**
- Modify: `src/store/db.ts`
- Test: `src/store/db.test.ts`

**Interfaces:**
- Produces: `export async function deleteSession(sessionId: string): Promise<void>`. It deletes the
  `sessions` index entry first, then `deleteDB(\`oc-session-${sessionId}\`)` (from `idb`). The
  index entry goes first so a concurrent `listSessions` never re-opens, and so re-creates, the
  database.

- [ ] **Step 1: Write failing tests.**
  - With two sessions created and closed, `deleteSession(a)`. `listSessions()` lists only `b`.
    `indexedDB.databases()` (fake-indexeddb supports it) has no `oc-session-<a>`, and still has
    `b`'s.
  - Then `listSessions()` again, and `oc-session-<a>` is still absent (Review Focus 4).
- [ ] **Step 2: Run** `npx vp test run src/store`. Expect them to FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expect them to PASS.
- [ ] **Step 5: Commit** "Add deleteSession to the store".

### Task 4: Delete in the session store

**Files:**
- Modify: `src/ui/session.ts`
- Test: `src/ui/session.test.ts` (the existing `fakeMesh` already records `sent` and has
  `deliver(peer, msg)`)

**Interfaces:**
- Consumes: `db.deleteSession` (add `deleteSession: typeof db.deleteSession` to `SessionDeps` and
  the real deps).
- Produces:
  - `export const DELETE_REPLY_MS = 3_000`;
  - `deleteSession(): Promise<void>` on the store;
  - the wire messages `{ t: "delete-session"; workstation: string }` and `{ t: "deleted" }`;
  - a `deskName(deviceId)` helper, private to the store. It returns the `workstation` of that
    device's highest-`seq` record, else the peer's `employee`, else `"Unnamed"`.

Behaviour:
- `deleteSession()` does nothing unless a session is open and `closed`.
- It sends `delete-session` to each connected peer (`mesh.send`). It waits until every one of
  them has replied `deleted`, or until `DELETE_REPLY_MS` has passed. With no connected peers it
  doesn't wait.
- Then it runs `teardown()`, then `deps.deleteSession(id)`, then `screen = "launch"` and
  `notice = "Session ‘<name>’ deleted."`. When some peers didn't reply, the notice adds
  `" Not confirmed on: <deskName…joined ', '>."`.
- `attachMesh` also subscribes to `m.onMessage`, and `detachMesh` unsubscribes.
- On `delete-session`:
  - if the session is not `closed`, ignore it;
  - otherwise reply `deleted` to that peer, then `teardown()` and `deps.deleteSession(id)`;
  - notice `Session ‘<name>’ was deleted on <workstation>.`. Use the sender's `workstation` if it
    is a non-empty string within `MAX_NAME`, else `another workstation`.
- Guard with a `deleting` flag, so a second message or a second call during the delete is ignored
  (Review Focus 1).
- If `deps.deleteSession` throws, set `fatal` to `Could not delete the session: <message>`.

- [ ] **Step 1: Write failing tests** (use `vi.useFakeTimers()` for the timeout):
  - On a closed session with a connected peer, start `deleteSession()`. `sent` contains
    `{t:"delete-session", workstation:<this name>}`. Delivering `{t:"deleted"}` from the peer
    resolves it. Then the screen is `"launch"`, the notice is `Session ‘Outage’ deleted.`, the mesh
    is closed, and the store's `deleteSession` was called with the id.
  - With no reply, after advancing 3000 ms the notice ends `Not confirmed on: Back desk.`. The
    peer's name comes from its records' `workstation`.
  - With no connected peers, it resolves without advancing timers (Review Focus 2).
  - On an open (not closed) session, it does nothing.
  - Incoming `delete-session` on a closed session: `sent` has `{t:"deleted"}`, the screen is
    launch, and the notice is `Session ‘Outage’ was deleted on Front desk.`. Delivered twice, the
    store deletes once (Review Focus 1). Without `workstation`, the notice says
    `on another workstation`.
  - Incoming `delete-session` on an open session is ignored: no reply, the session stays.
- [ ] **Step 2: Run** `npx vp test run src/ui/session.test.ts`. Expect them to FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vp test run` and `npx vp check`. Expect both to PASS.
- [ ] **Step 5: Commit** "Delete a closed session here and on connected workstations".

### Task 5: Slide to confirm

**Files:**
- Create: `src/ui/slide.ts`, `src/ui/slide.test.ts`
- Create: `src/ui/components/SlideToConfirm.vue`

**Interfaces:**
- Produces:
  - `slide.ts`: `export const SLIDE_STEP = 20` and
    `export function slideKey(value: number, key: string): { value: number; confirm: boolean } | null`.
    It handles ArrowRight/ArrowUp (+20), ArrowLeft/ArrowDown (−20), Home (0) and End (100), and
    clamps to 0–100. `confirm` is true when the value reaches 100. Any other key, Enter and Space
    included, returns `null`.
  - `export function slideRelease(px: number, trackPx: number): boolean` is true when `px` is
    within 8 px of `trackPx`.
  - `SlideToConfirm.vue`: prop `label: string`, emits `confirm`. The handle has
    `role="slider"`, `tabindex="0"`, `aria-valuemin="0"`, `aria-valuemax="100"`,
    `aria-valuenow`, and `aria-valuetext` of `"<label>, <n>%"`. Pointer events with
    `setPointerCapture`; releasing short of the end snaps back to 0. A red track and a
    `min-h-12` handle, in the style of `danger` in SummaryScreen.

- [ ] **Step 1: Write failing tests** for `slideKey` and `slideRelease`:
  - From 0, ArrowRight five times reaches 100, and only the last returns `confirm: true`.
  - End gives `{ value: 100, confirm: true }`.
  - Home gives 0, and ArrowLeft at 0 stays at 0.
  - Enter, Space (`" "`) and `"a"` return `null` (Review Focus 5).
  - `slideRelease(292, 300)` is true and `slideRelease(270, 300)` is false.
- [ ] **Step 2: Run** `npx vp test run src/ui/slide.test.ts`. Expect them to FAIL.
- [ ] **Step 3: Implement** `slide.ts` and the component. The component calls `slideKey` on
  keydown and calls `preventDefault` only when the result isn't null.
- [ ] **Step 4: Run** `npx vp test run` and `npx vp check`. Expect both to PASS.
- [ ] **Step 5: Commit** "Add a slide-to-confirm control".

### Task 6: Delete on the Summary page

**Files:**
- Modify: `src/ui/screens/SummaryScreen.vue`
- Create: `src/ui/exports.ts`, `src/ui/exports.test.ts`

**Interfaces:**
- Consumes: `state.exports` (Task 1), `session.deleteSession()` (Task 4), `SlideToConfirm`
  (Task 5), and the existing `notConnected`.
- Produces: `exports.ts`,
  `export function exportLines(exports: ExportState[], time: (at: number) => string): { kind: ExportKind; text: string }[]`.
  It returns one line per kind in the order pdf, csv, xlsx, xacts, using the latest export of each
  (highest `at`) and the copy from Global Constraints. `time` is injected so tests are stable.
  SummaryScreen passes `(at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`.

- [ ] **Step 1: Write failing tests** for `exportLines`:
  - With no exports, four lines: `No PDF download recorded`, `No CSV file download recorded`,
    `No Excel file download recorded` and `No Evergreen file download recorded`.
  - With two xacts exports, the later one wins:
    `Evergreen file: downloaded 3:12 PM by Ann (Front desk)`.
  - With an empty workstation there are no parentheses.
- [ ] **Step 2: Run** the tests. Expect them to FAIL. Then implement `exportLines`, and run them
  again. Expect them to PASS.
- [ ] **Step 3: Implement the UI.**
  - `confirming` gains `"delete"`.
  - When `session.closed`, add a section headed `Delete session` with a `danger` button
    `Delete session` that opens it.
  - The dialog shows the body text, the export lines, and the red Evergreen warning when no `xacts`
    export exists. It shows the not-connected line from the existing `missingNames`, with the
    `It keeps its copy.` / `They keep their copies.` copy, which replaces the export "may be
    missing" sentence for delete. Then `<SlideToConfirm label="Slide to delete">` and Cancel.
  - Confirm sets `confirming = null`, then awaits `session.deleteSession()`.
  - `trapTab` selects `button, [role=slider]`. The red border applies to `"close"` and `"delete"`.
- [ ] **Step 4: Run** `npx vp check` and `npx vp test run`. Expect both to PASS.
- [ ] **Step 5: Commit** "Add Delete session to the summary of closed sessions".

### Task 7: End-to-end test and docs

**Files:**
- Create: `e2e/delete-session.spec.ts` (helpers: `openApp`, `pairViaPaste`, `stubPrint`; the
  `download` and `scan` helpers as in `e2e/full-flow.spec.ts`)
- Modify: `README.md` (in the Summary/closing section: deleting a closed session, the export lines,
  and that desks not connected keep their copy), `DEVELOPMENT.md` (the `exported` record under
  Storage; the `delete-session`/`deleted` messages under Pairing and sync)

- [ ] **Step 1: Write the e2e test.**
  - A ("Front desk") starts "Outage" and pairs B ("Back desk").
  - A scans P1, I1, OC-END. B's Summary has no `Delete session` button while the session is open.
  - A closes the session, and A downloads the Evergreen file.
  - On B, open Delete session. The dialog contains `Evergreen file: downloaded` and
    `(Front desk)`, and does not contain `Download the Evergreen file first`.
  - Focus the slider and press Enter. The dialog is still open (Review Focus 5).
  - Drag the handle to the end with `page.mouse` down, move and up. B shows the notice
    `Session ‘Outage’ deleted.`, and its start page lists no "Outage".
  - A shows `Session ‘Outage’ was deleted on Back desk.`, with no "Outage" in its list.
  - Second test, one workstation: close a session with no exports. The dialog shows
    `Download the Evergreen file first…`. Press End on the slider, and the session is gone.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/delete-session.spec.ts`. Expect it
  to PASS. (`npx playwright test` alone reuses an old `dist/`.)
- [ ] **Step 3: Update** README and DEVELOPMENT.
- [ ] **Step 4: Run** `npx vp check`, `npx vp test run` and `npm run e2e`. Expect all to PASS.
- [ ] **Step 5: Commit** "Test and document deleting sessions".
