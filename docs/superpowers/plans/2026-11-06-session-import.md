# Add to Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Summary, staff can add another session on this PC, or CSV, Excel and Evergreen files exported by the app, to the open session, which then syncs and exports as one log.

**Architecture:** New pure code in `src/import/` turns a source into log records: a rewrite for sessions, parsers plus a planner for files. `SessionStore.importRecords` saves them in one strict transaction, and the existing vector exchange carries them to peers. Made-up devices carry `imported: true`, so nothing treats them as workstations.

**Tech Stack:** TypeScript, Vue 3, Pinia, IndexedDB (`idb`), `fflate` (already a dependency), Vitest with `fake-indexeddb`, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-session-import-design.md`

## Global Constraints

- No schema migration, no pairing payload change, the prefix stays `OC3:`, and no new dependencies.
- Every record this feature creates must pass `isLogRecord`. A rejected record leaves a `seq` gap on peers and they get it resent every 10 seconds.
- Clerk fields start empty and are required. Never pre-fill **Your name**.
- `README.md` stays to headings, lists, bold, inline code and links. Developer detail goes in `DEVELOPMENT.md`.
- Tests import from `vite-plus/test`. Before the PR: `npx vp check`, `npx vp test run`, `npm run e2e`.
- Commit messages are plain sentences in this repo's style ("Add ...", "Make ..."), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions This Plan Adds To The Spec

- **XML is read by a small hand-written scanner** (`src/import/xml.ts`), not `DOMParser`. Unit tests run in Vitest's `node` environment, which has no `DOMParser`, so tests exercise the same code that ships, with no new dependency. The scanner also keeps memory flat on large sheets.
- **A batch is one session or several files.** Each kind of source opens its own preview.
- **Voided here applies to files only (spec section 3).** A session source copies its real log, so an item voided here but live in the source does come back, and the preview counts it as added.
- **New voids count as a change.** Re-adding a source whose only news is a void still stores it, writes an `imported` record with its counts, and the preview says "3 items voided in the source."
- **A source whose only new records are `import-gap` changes nothing** and stores nothing. Those gaps go in with the next real change, so `seq` stays contiguous.
- **`addToSession` plans again inside `enqueue`,** so state that changed while the preview was open is respected.
- **Blank-item rows:** `at` is the file's earliest row time, or `now` if it has none. The row is dropped if the batch has an item row for that patron. "Already in the session" includes voided visits.
- **Evergreen lines must have exactly the six keys the app writes,** so a `due_date` is never silently dropped.
- **Excel files using the 1904 date system are rejected,** because their times would be four years off.
- **CSV `'` is removed only before a character `guard` escapes** (`/^'(?=[=+\-@\t\r])/`), so `'Tis` stays as it is.
- **Scientific notation is `/^\d+(\.\d+)?E\+\d+$/`:** it requires the `+` Excel always writes, so a real barcode like `12E5` is accepted.

## Review Focus

- **A source session that already holds imports** (Monday adds Saturday, which holds Friday): ids are rewritten again, nothing collides, each checkout appears once and voids stay attached. Test in Task 2.
- **The log changes while the preview is open** (a peer's void or a new scan arrives): confirming respects the latest state, so a just-voided item isn't brought back. Test in Task 7.
- **Re-adding a source after voids there:** the voids apply, the totals go down, and the counts never go negative. Tests in Tasks 6 and 7.
- **File text a peer would refuse** (clerk or workstation over `MAX_NAME`, a very long file name): it is clamped, so every planned record and audit passes `isLogRecord`. Test in Task 6.
- **A source that disappears:** a dropped folder or a file on a removed flash drive rejects only that file, and a session deleted after it was listed gives an error without re-creating an empty database. Tests in Tasks 3 and 4.

---

### Task 1: Log records, validation and reduce

**Files:**
- Modify: `src/log/types.ts`, `src/log/validate.ts`, `src/log/reduce.ts`
- Test: `src/log/validate.test.ts`, `src/log/reduce.test.ts`

**Interfaces:**
- Produces:
  - `Envelope.imported?: true`
  - `RecordBody` adds `{ type: "imported"; source: "session" | "file"; name: string; patrons: number; items: number }` and `{ type: "import-gap" }`
  - `export type ImportedBody = Extract<RecordBody, { type: "imported" }>`
  - `export interface ImportState { source: "session" | "file"; name: string; patrons: number; items: number; at: number; employee: string; workstation: string }`
  - `SessionState.imports: ImportState[]` (in record order)
  - `VisitState.imported: boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// validate.test.ts
it("accepts imported only as true or absent", () => {
  expect(isLogRecord({ ...patron, imported: true })).toBe(true);
  expect(isLogRecord({ ...patron, imported: false })).toBe(false);
  expect(isLogRecord({ ...patron, imported: 1 })).toBe(false);
});
it("checks import records", () => {
  const body = { type: "imported", source: "file", name: "a.csv", patrons: 1, items: 2 };
  expect(isLogRecord({ ...env, ...body })).toBe(true);
  expect(isLogRecord({ ...env, ...body, source: "pdf" })).toBe(false);
  expect(isLogRecord({ ...env, ...body, name: "x".repeat(MAX_NAME + 1) })).toBe(false);
  expect(isLogRecord({ ...env, ...body, patrons: -1 })).toBe(false);
  expect(isLogRecord({ ...env, ...body, items: 1.5 })).toBe(false);
  expect(isLogRecord({ ...env, type: "import-gap" })).toBe(true);
});
// reduce.test.ts
it("collects imports and ignores gaps", () => {
  const s = reduce([
    mk(dev("a"), 1, { type: "import-gap" }),
    mk(dev("a"), 2, { type: "imported", source: "session", name: "Friday", patrons: 1, items: 2 }),
  ]);
  expect(s.imports).toEqual([
    { source: "session", name: "Friday", patrons: 1, items: 2, at: 2000, employee: "AAAAAAAAAA", workstation: "" },
  ]);
  expect(s.visits).toEqual([]);
  expect(s.name).toBeNull();
  expect(s.closed).toBe(false);
});
it("marks visits from imported records", () => {
  const started = mk(dev("a"), 1, { type: "patron-started", patron: "P1" });
  expect(reduce([started]).visits[0]!.imported).toBe(false);
  expect(reduce([{ ...started, imported: true }]).visits[0]!.imported).toBe(true);
});
```

Reuse or add `env` and `patron` fixtures in `validate.test.ts`, following that file's existing style.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/log`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the types, `isLogRecord` cases and `reduce` cases**

The `reduce` switch gets `imported` (push to `imports`, shaped like `exported`) and `import-gap` (break). `patrons` and `items` must be non-negative integers.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/log`
Expected: PASS.

- [ ] **Step 5: Commit** with "Add imported log records and the imported flag".

---

### Task 2: Rewriting a source session

**Files:**
- Create: `src/import/session.ts`
- Test: `src/import/session.test.ts`, `src/sync/sim.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `mergedDeviceId(sourceSessionId: string, deviceId: string): Promise<string>`: SHA-256 of `` `${sourceSessionId}:${deviceId}` ``, mapped to 10 characters of `[0-9a-z]` (byte % 36).
  - `rewriteSession(records: LogRecord[], sourceSessionId: string, targetSessionId: string): Promise<LogRecord[]>`
  - `sessionSource(source: { sessionId: string; name: string }, raw: LogRecord[], targetSessionId: string): Promise<SessionSource>`
  - ```ts
    export interface SessionSource {
      kind: "session";
      name: string;
      /** Already rewritten for the target session. */
      records: LogRecord[];
      stillOpen: boolean;
      /** The source's latest Evergreen download, if any. */
      evergreen: ExportState | null;
    }
    ```

- [ ] **Step 1: Write the failing tests** in `session.test.ts`

```ts
it("gives a valid, stable id", async () => {
  const id = await mergedDeviceId("ses0000001", dev("a"));
  expect(id).toMatch(/^[0-9a-z]{10}$/);
  expect(await mergedDeviceId("ses0000001", dev("a"))).toBe(id);
  expect(await mergedDeviceId("ses0000002", dev("a"))).not.toBe(id);
});
it("can't collide with the same PC's records in the target", ...);       // own device, same seq: keys differ
it("keeps voids attached", ...);                                         // reduce(rewritten): voided item and patron stay voided
it("keeps seq, at, employee and workstation, and sets imported", ...);
it("doesn't close or rename the target", ...);                           // session-created, session-closed, exported, imported → import-gap; state.closed false; name from target's own record
it("keeps a gap for every replaced record", ...);                        // vectorOf(rewritten)[merged] === source length
it("drops replaced records' body fields", ...);                          // gap has no name, kind, patrons
it("passes isLogRecord for every record", ...);
it("rewrites a session that already holds imports", ...);                // two levels: new device ids, imported stays true, voids attached, exportRows has each checkout once
it("reports stillOpen and the latest Evergreen download", ...);
```

Add to `sim.test.ts`:

```ts
it("a peer takes a rewritten device once, with no repeat sends", async () => {
  // A's store holds rewriteSession output including gaps; B is empty; link up.
  // Advance 30 s: B's records equal A's, reduce() matches, vectorOf(B)[merged] === length.
  // Spy on A's mesh.send: after convergence, advance 30 s more, and no further `recs` messages go out.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/import src/sync/sim.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/import/session.ts`**

Cache hashes per device id. `visitId` and `target` may name a device with no records here, so hash those too; split at `lastIndexOf(":")`. Copied record types are `patron-started`, `item-scanned`, `patron-ended` and `voided`. Every other type becomes a gap, including an existing `import-gap`. A gap is the envelope plus `type: "import-gap"`, with no body fields.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/import src/sync/sim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with "Rewrite a source session's records for adding to another session".

---

### Task 3: Store: read a source, save an import, ignore imported devices

**Files:**
- Modify: `src/store/db.ts`, `src/ui/session.test.ts` (fake store only)
- Test: `src/store/db.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `readRecords(sessionId: string): Promise<LogRecord[]>`: no lock. Throws `Unknown session` if the session isn't in the index, and doesn't open its database in that case.
  - `export interface ImportAudit { employee: string; body: ImportedBody }`
  - `SessionStore.importRecords(records: LogRecord[], audits: ImportAudit[]): Promise<LogRecord[]>`: returns newly stored records plus audits.

- [ ] **Step 1: Write the failing tests**

```ts
describe("importRecords", () => {
  it("stores new records, skips existing keys and other sessions", ...);
  it("writes audits through nextSeq under the given clerk", async () => {
    // meta.employee "Ann"; audit employee "Bob"
    // stored audit: { deviceId: own, seq: nextSeq, employee: "Bob", workstation: meta's, type: "imported" }
    // meta.nextSeq advanced; meta.employee still "Ann"
  });
  it("skips this machine's deviceId, as put does", ...);
  it("rolls back completely on failure", async () => {
    const bad = { ...good, seq: Number.NaN };
    await expect(store.importRecords([good, bad], [audit])).rejects.toThrow();
    expect(await store.all()).toEqual(before);
    expect((await store.meta()).nextSeq).toBe(nextSeqBefore);
  });
  it("adding the same records twice stores nothing the second time", ...);
});
describe("readRecords", () => {
  it("reads a session another tab holds the lock on", ...);
  it("rejects a deleted session and doesn't re-create it", async () => {
    await deleteSession(id);
    await expect(readRecords(id)).rejects.toThrow();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(`oc-session-${id}`);
  });
});
it("listSessions leaves imported devices out of workstations", ...);   // section 5, readLog row
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/store`
Expected: FAIL.

- [ ] **Step 3: Implement**

`importRecords` uses one `["records", "meta"]` strict transaction. Filter and queue as `put` does (same key, session and own-device rules), then `add` each audit with `seq = m.nextSeq + i`, `at = Date.now()`, and `workstation` from meta when set; then `put` meta with the new `nextSeq` only. Handle failure like `append` (abort, swallow `tx.done`, rethrow). In `readLog`, skip `r.imported` records when building `latest`. Add `importRecords` to the fake store in `session.test.ts` so types pass: the same filtering as its `put`, plus audits through `meta.nextSeq`, with a `failImport` switch alongside `failAppends`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/store src/ui/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with "Add readRecords and an all-or-nothing importRecords".

---

### Task 4: Reading CSV and Evergreen files, and detection

**Files:**
- Create: `src/import/rows.ts`, `src/import/read.ts`, `src/import/csv.ts`, `src/import/xacts.ts`
- Test: `src/import/read.test.ts`, `src/import/csv.test.ts`, `src/import/xacts.test.ts`

**Interfaces:**
- Consumes: `COLUMNS` and `ExportRow` from `src/export/rows.ts`, `validateBarcode`.
- Produces, in `rows.ts`, so parsers and `read.ts` don't import each other:
  - `export type ImportRow = Omit<ExportRow, "session">`
  - `export type FileFormat = "csv" | "xlsx" | "xacts"`
  - `export interface FileSource { kind: "file"; name: string; format: FileFormat; rows: ImportRow[] }`
  - `export interface FileRejection { name: string; reason: string }`
  - `export class RejectFile extends Error`: parsers throw it, with `reason` as its message.
  - `export interface NumberedRow extends ImportRow { rowNumber: number }`
- Produces, in `read.ts`:
  - `readImportFile(name: string, bytes: Uint8Array, now: number): FileSource | FileRejection`
  - `readImportFiles(files: File[], now: number): Promise<(FileSource | FileRejection)[]>`
  - `export const MAX_FILE_BYTES = 50 * 1024 * 1024`
- Produces: `parseCsv(text: string): NumberedRow[]`, `isCsvHeader(text: string): boolean`, `parseXacts(text: string): NumberedRow[]`.

**Exact reasons:**

| Case | `reason` |
| --- | --- |
| PDF | `A PDF can't be added because it has no scan times. Use the Excel or Evergreen file.` |
| Unknown | `This isn't a file exported by Offline Checkout.` |
| Over 50 MB | `This file is over 50 MB.` |
| Unreadable | `This file could not be read.` |
| CSV time changed | `Row N: the time was changed, probably by Excel saving this CSV, and barcodes may be damaged too. Use the original file, the Excel file or the Evergreen file.` |
| Bad barcode | `Row N: ` + `validateBarcode`'s reason |
| Scientific notation | `Row N: "1.23E+13" looks like a number Excel changed.` |
| Item with no time | `Row N: the item has no time.` |
| Future time | `Row N: the time is more than a day in the future.` |
| Other Evergreen line | `Line N: this is not a checkout the app wrote.` |
| Evergreen times differ | `Line N: timestamp and checkout_time differ.` |

- [ ] **Step 1: Write the failing tests**

```ts
// csv.test.ts
it("round-trips buildCsv", ...);          // quotes, newlines in names, blank-item rows, local times to the second
it("removes only the ' that guard adds", () => { /* "-123" round-trips; a clerk named "'Tis" stays */ });
it("accepts LF and no BOM", ...);
it("rejects Excel's rewritten time", () => { /* "11/6/2026 14:05" → the "time was changed" reason */ });
it("rejects 2026-02-31 and a wrong column count", ...);
// xacts.test.ts
it("round-trips buildXacts", ...);        // ms-accurate time, clerk "", workstation ""
it("rejects other types, extra keys, missing keys, bad JSON", ...);  // e.g. { ..., due_date } is refused
it("rejects timestamp and checkout_time more than a second apart", ...);
// read.test.ts
it("detects by content, not extension", ...);  // csv named .txt; xacts named .csv
it("gives the PDF reason and refuses unknown or empty files", ...);
it("refuses files over the limit", ...);
it("rejects scientific notation and accepts 12E5", ...);
it("rejects a control code, a bad barcode, an item with no time, a future time", ...); // first bad row number in the reason
it("accepts a time less than a day ahead", ...);
it("is all or nothing", ...);              // one bad row → FileRejection, no rows
it("a blank-item row with no time is accepted", ...);
it("readImportFiles rejects only the unreadable file", async () => {
  const gone = { name: "folder", size: 0, arrayBuffer: () => Promise.reject(new Error("NotFound")) } as unknown as File;
  // [gone, good.csv] → [{ name: "folder", reason: "This file could not be read." }, FileSource]
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/import`
Expected: FAIL for the new tests.

- [ ] **Step 3: Implement**

`readImportFile` order: size, then `PK\x03\x04` (Task 5 fills in the Excel branch; until then reject it as unknown), then `%PDF`, then text from `new TextDecoder()` (which strips the BOM). A first line starting with `{` is Evergreen; a header equal to `COLUMNS` is CSV; otherwise unknown. Shared row checks live in `read.ts` and run after any parser. Parsers supply a row number for messages: 1-based, with the CSV header as row 1.

CSV time: check the pattern and validate the fields with a `Date.UTC` round trip. Then build with `new Date(y, m - 1, d, h, mi, s)`, so a time in a clock-change gap from another zone isn't refused and the repeated hour resolves to the first.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/import`
Expected: PASS.

- [ ] **Step 5: Commit** with "Read exported CSV and Evergreen files, and refuse anything else".

---

### Task 5: Reading Excel files

**Files:**
- Create: `src/import/xml.ts`, `src/import/xlsx.ts`
- Modify: `src/import/read.ts`
- Test: `src/import/xml.test.ts`, `src/import/xlsx.test.ts`

**Interfaces:**
- Consumes: `RejectFile`, `NumberedRow` from `src/import/rows.ts` (Task 4), `COLUMNS`, `buildXlsx`.
- Produces:
  - `scanXml(xml: string, on: { open(name: string, attrs: Record<string, string>): void; text(value: string): void; close(name: string): void }): void`. Names have any namespace prefix removed, in elements and attributes. Text has the five named entities and numeric references decoded. Self-closing tags fire `open` then `close`. Comments and processing instructions are skipped.
  - `parseXlsx(bytes: Uint8Array, opts?: { maxPartBytes?: number }): NumberedRow[]`, with `MAX_PART_BYTES = 200 * 1024 * 1024`.
  - `fromExcelDate(serial: number): number`, the inverse of `excelDate`: read the wall clock from the serial as UTC, round to the second, and rebuild with the local `Date` constructor.

**Exact reasons:** `Row N: Patron is a number, so Excel may have changed it.`, the same for `Item`, `Row N: Scanned at is not a date.`, `This Excel file has no Items sheet.`, `This Excel file's columns don't match an export.`, `This Excel file uses the 1904 date system.`, `This Excel file is too large to read.`, and `This isn't a file exported by Offline Checkout.` for a zip with no workbook.

- [ ] **Step 1: Write the failing tests**

```ts
// xml.test.ts
it("handles prefixes, either quote style, self-closing tags and entities", ...);
it("skips comments and the declaration", ...);
// xlsx.test.ts: hand-built fixtures zipped with fflate's zipSync
it("round-trips buildXlsx", ...);                 // leading zeros, blank-item row, local time to the second
it("reads shared strings, including rich text runs and skipping phonetic rPh", ...);
it("finds columns from cell references when empty cells are omitted", ...);  // no Clerk cell: Workstation stays in its column
it("finds Items through the workbook when sheets are reordered", ...);       // Items is sheet2.xml; absolute and relative Targets
it("rejects numeric Patron and Item cells", ...);
it("rejects text in Scanned at", ...);
it("rejects a missing Items sheet, wrong headers and date1904", ...);
it("skips rows with no cells", ...);
it("refuses a part over the limit", () => { /* maxPartBytes: 10 → "too large" */ });
it("only inflates the parts it needs", ...);      // a huge unrelated part in the zip doesn't trigger the limit
it("fromExcelDate inverts excelDate", ...);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/import`
Expected: FAIL.

- [ ] **Step 3: Implement, and connect the zip branch in `readImportFile`**

Use `unzipSync` with a `filter` in two passes: first `xl/workbook.xml` and `xl/_rels/workbook.xml.rels`, then the Items part and `xl/sharedStrings.xml`. Check `originalSize` against the limit inside the filter. A zip that fflate can't read is the unknown-file rejection. Cell types: `s` and `inlineStr` and `str` are text, absent or `n` is a number; clerk, workstation and session take a number's text as it stands.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/import`
Expected: PASS.

- [ ] **Step 5: Commit** with "Read exported Excel files, including ones re-saved by Excel".

---

### Task 6: Planning an import

**Files:**
- Create: `src/import/plan.ts`
- Test: `src/import/plan.test.ts`

**Interfaces:**
- Consumes: `SessionSource` (Task 2), `FileSource`, `ImportRow` from `src/import/rows.ts` (Task 4), `reduce`, `isLogRecord` (tests), `clampName`, `ImportedBody`.
- Produces:

```ts
export type ImportSource = SessionSource | FileSource;
export const IMPORTED_CLERK = "Imported";
export interface SourcePlan {
  source: ImportSource;
  /** New records from this source; empty when it changes nothing. */
  records: LogRecord[];
  adds: { patrons: number; items: number };
  alreadyHere: number;
  voidedHere: number;
  /** Live here before, voided by this source's records. */
  voidedBySource: number;
  range: { from: number; to: number } | null;
  changed: boolean;
}
export interface ImportPlan {
  sources: SourcePlan[];
  records: LogRecord[];
  audits: ImportedBody[];
  /** Barcodes on more than one patron after this import and not before it. */
  alsoOnOtherPatron: number;
  anythingNew: boolean;
}
export function planImport(
  sources: ImportSource[],
  existing: LogRecord[],
  o: { sessionId: string; newDeviceId: () => string; now: number },
): ImportPlan;
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("files", () => {
  it("makes contiguous records per file", ...);  // fresh device; seq 1..n; patron-started at earliest row; items at row times; patron-ended at latest; all imported: true
  it("keeps each row's clerk and workstation, and uses Imported when none", ...);  // no workstation field when ""
  it("counts rows already here, whatever their time", ...);
  it("doesn't add rows voided here", ...);       // { voidedHere: 1, items: 0 }; a pair both voided and live counts as already here
  it("prefers a row with clerk details, then the earliest", ...);  // xacts + xlsx: the xlsx row wins; csv + xlsx: earliest wins
  it("three formats of one session add each checkout once", ...);  // later files: adds 0, alreadyHere = all, changed false, no audit
  it("blank-item patron becomes an empty visit unless already in the session", ...);  // including a voided visit, and an item row in the batch
  it("gives a blank-item visit the file's earliest time, or now", ...);
  it("clamps long clerk, workstation and file names", () => {
    // clerk and workstation of MAX_NAME + 50, long file name:
    expect([...plan.records, ...auditRecords].every(isLogRecord)).toBe(true);
  });
});
describe("sessions", () => {
  it("stores nothing the second time", ...);     // existing includes rewritten: anythingNew false, no audit
  it("stores only the new records after more scans", ...);
  it("a source with only new gaps changes nothing", ...);
  it("counts already-here pairs", ...);
  it("brings back an item voided here that is live in the source", ...);   // adds.items 1, voidedHere 0
  it("a void added later in the source applies", ...);  // adds 0, voidedBySource 1, changed true, one audit, counts not negative
});
it("adds are by source, in order", ...);          // second source's adds exclude the first's
it("counts barcodes also on another patron, only if new", ...);
it("gives the date range from items", ...);       // null when no item has a time
it("writes one audit per changed source, with what it added", ...);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/import/plan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `planImport`**

Pure, apart from what `newDeviceId` returns. In order:

1. Reduce `existing` into live pairs, voided-only pairs and all patrons.
2. Pick batch winners across file rows.
3. For each source, build its new records (for a session, those whose `recordId` isn't in `existing`). If none is anything but `import-gap`, use none and `changed: false`.
4. Reduce the cumulative records to get `adds` and `voidedBySource` as set differences of live pairs and live patrons.

Pair keys use `JSON.stringify([patron, item])`, as `reduce` does.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/import/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with "Plan what each source adds to a session".

---

### Task 7: Session store: adding, and imported devices aren't workstations

**Files:**
- Modify: `src/ui/session.ts`
- Test: `src/ui/session.test.ts`

**Interfaces:**
- Consumes: `planImport`, `sessionSource`, `readImportFiles`, `importRecords`, `readRecords`.
- Produces on `useSession()`:
  - `otherSessions(): Promise<SessionSummary[]>`: `listSessions` without the current one.
  - `loadSessionSource(s: SessionSummary): Promise<SessionSource>`
  - `readFiles(files: File[]): Promise<(FileSource | FileRejection)[]>`
  - `previewImport(sources: ImportSource[]): ImportPlan`: planned against `records.value`.
  - `addToSession(sources: ImportSource[], clerk: string): Promise<boolean>`
- Deps: `SessionDeps.readRecords: typeof db.readRecords`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("addToSession", () => {
  it("stores, merges and reports", async () => {
    // true returned; state totals updated; state.imports[0].employee === "Bob"
    // meta.employee still the session's clerk
    // message { tone: "info", text: "Added 1 patron and 2 items." }
  });
  it("works in a closed session, which stays closed", ...);
  it("runs in the queue, after an earlier scan", ...);
  it("plans again when confirmed", async () => {
    // preview a file with P1/I1 → adds 1; a peer's scan and void of P1/I1 then arrive through onRecords;
    // addToSession adds nothing for it and returns false
  });
  it("applies a void added later in the source", ...);   // totals go down
  it("needs a clerk", ...);                              // "   " → false, nothing stored
  it("a failed save shows an error, isn't fatal, and scanning continues", ...);
  it("doesn't add to a session that was switched", ...);
});
describe("imported devices are not workstations", () => {
  // `seed` adds rewritten records for a device with an unended visit and a workstation name
  it("knownDevices leaves them out", ...);
  it("notConnected leaves them out", ...);
  it("disconnected stays false on a solo PC", ...);
  it("othersInProgress leaves out an unfinished imported visit", ...);
  it("real peers still count", ...);
});
it("otherSessions leaves out the current session", ...);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/ui/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Skip `r.imported` in `knownDevices`, `notConnected` and `disconnected`, and `v.imported` in `othersInProgress`. In `addToSession`, `clampName` the clerk and return false if it's blank. Inside `enqueue`, re-run `planImport` with `deps.now().getTime()` and `randomId`; return false if `!anythingNew`. Otherwise call `store.importRecords(plan.records, plan.audits.map((body) => ({ employee: clerk, body })))`, drop the result if `store` changed, `merge` it, and set the banner. Don't `pushLocal`, because the vector exchange carries it. On failure set `message` to `{ tone: "error", text: "Could not add to this session, so nothing was changed. (<reason>)" }` and return false, never `fatal`. Note that `enqueue` skips its task when the session has changed, so `addToSession` must start false and only set true on success.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vp test run src/ui/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with "Add sources to the open session, and keep imported devices out of workstation lists".

---

### Task 8: Add to this session card and preview

**Files:**
- Create: `src/ui/components/AddToSession.vue`, `src/ui/import-preview.ts`, `src/ui/focus-trap.ts`, `e2e/add-to-session.spec.ts`
- Modify: `src/ui/screens/SummaryScreen.vue`
- Test: `src/ui/import-preview.test.ts`

**Interfaces:**
- Consumes: the Task 7 store functions, `ImportPlan`, `ImportState`.
- Produces:
  - `trapTab(container: HTMLElement | null, e: KeyboardEvent): void`, moved from `SummaryScreen.vue`, which now uses it. Selector: `button:not(:disabled), input, [role=slider]`.
  - `sourceLine(p: SourcePlan): string`
  - `sourceHeading(p: SourcePlan, date: (at: number) => string): string`
  - `previewWarnings(plan: ImportPlan, time: (at: number) => string): string[]`
  - `importLine(i: ImportState, time: (at: number) => string): string`

**Exact copy:**

| Where | Text |
| --- | --- |
| `sourceLine` | `Adds 118 patrons and 240 items. 6 already here. 2 voided here, not added. 3 items voided in the source.` Parts after "Adds" appear only when non-zero; singular is `1 patron`, `1 item` |
| `sourceHeading` | `friday.xlsx: Excel file, Nov 6 to Nov 7`; types are `Session`, `CSV file`, `Excel file`, `Evergreen file`; one date when both match; no dates when `range` is null |
| Double upload, always | `If any of these checkouts are already in Evergreen, the new Evergreen file would check them out again.` |
| Source had a download | `Friday had an Evergreen download at 9:02 AM on Nov 6 by Ann (Front desk 1).` |
| Other patron | `3 items are also on another patron.` (`1 item is`) |
| Evergreen file with adds | `An Evergreen file has no clerk or workstation, so its items count under Imported.` |
| Source open | `Friday is still open. Scans made there later need adding again.` |
| Rejected files note | `The other files can still be added.` (only with at least one accepted file) |
| Nothing new | `Nothing new to add. Everything here is already in this session.` |
| `importLine` | `friday.xlsx: 118 patrons, 240 items, added 9:02 AM by Ann (Front desk 1)` |

- [ ] **Step 1: Write the failing unit tests**

One test per row of the table above, in `import-preview.test.ts`, including singulars and omitted parts.

- [ ] **Step 2: Write the failing e2e test**

Helpers: `scan`, `closeSession` (as in `delete-session.spec.ts`), and `exitSession` (**Exit session**, then **Yes, exit session**).

```ts
test("Friday and Saturday combine into one Evergreen file", async ({ page }) => {
  // Friday: P1 I1 OC-END, P2 I2 OC-END; save its Evergreen download; close; exit.
  // Saturday: P1 I1 OC-END, P3 I3 OC-END; Summary.
  // Add another session → Friday. The dialog shows "Adds 1 patron and 1 item. 1 already here."
  //   and the double-upload warning. Add to session stays disabled until Your name is filled.
  // Your name starts empty. Fill it; Add to session.
  // Totals "Patrons 3 · Items 3". "Added to this session" lists Friday by that clerk.
  // Decode Saturday's Evergreen download: exactly P1/I1, P2/I2, P3/I3, each once;
  // P2/I2's checkout_time equals the one in Friday's own file.
  // Back on Launch, Friday is still listed and unchanged.
});
test("adding into a closed session keeps it closed", ...);
test("a second add says nothing is new and offers only Close", ...);
test("Excel, CSV and Evergreen files of one session add each checkout once", ...);
  // setInputFiles on the add-files input with all three, plus a PDF and a junk file:
  // both are rejected with reasons, the note shows, and totals are right after adding.
test("files dropped on the zone open the preview", ...);   // DataTransfer on add-drop-zone
test("a file dropped outside the zone is blocked", async ({ page }) => {
  // dispatch dragover and drop with Files on body: both defaultPrevented; URL unchanged.
});
test("a scan while the preview is open isn't recorded, and Escape closes it", ...);
test("two paired workstations both get an import, with no Not connected entry", ...);
  // pairViaPaste, add a file on A. B's totals update within 15 s;
  // neither shows not-connected, nor "Unnamed"; both Summaries match.
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vp test run src/ui/import-preview.test.ts && npm run build && npx playwright test e2e/add-to-session.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

`AddToSession.vue` sits in `SummaryScreen.vue` below the Totals and Export section, for open and closed sessions. It holds:

- an **Add another session** section (`data-testid="other-sessions"`): one button per session with name, start time and `open` or `closed` from `closedAt`, reloaded each time the Summary opens or a dialog closes, with an empty-state line when there are none;
- a drop zone (`data-testid="add-drop-zone"`) and a **Choose files** button with a hidden multiple file input (`data-testid="add-files"`). Reset the input's value after reading, so the same file can be chosen again;
- window `dragover` and `drop` listeners, as in `PairScreen.vue`'s `blockFileDrop`, removed on unmount;
- the **Added to this session** list from `session.state.imports`, shown when not empty.

The dialog sets `session.toolbarDialog = true` on open, and false on close and unmount, so `ScanInput` pauses. It is `role="dialog"` with `aria-modal`, z-40 overlay, `max-h-[90vh] overflow-y-auto`, Escape to close and `trapTab`. Focus moves to **Your name** on open. **Your name** is empty every time the dialog opens. **Add to session** is disabled until a trimmed name exists and `plan.anythingNew`; pressing Enter in the field does nothing. When accepted sources add nothing new, show the nothing-new line and only **Close**. When every file was rejected, show the rejections and only **Close**. A failed session read (`loadSessionSource` rejects) sets `session.message` to an error, opens no dialog and reloads the list. Use the same `button`, `primary` and `secondary` classes as the Summary.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vp test run src/ui && npm run build && npx playwright test e2e/add-to-session.spec.ts`
Expected: PASS.

- [ ] **Step 6: Look at it in a browser**

Open the built file at 1366x768, on both open and closed sessions, with a preview holding several sources and warnings. Confirm the dialog scrolls and its buttons stay reachable.

- [ ] **Step 7: Commit** with "Add the Add to this session card and preview".

---

### Task 9: Stale export warnings, closing advice and docs

**Files:**
- Modify: `src/ui/exports.ts`, `src/ui/screens/SummaryScreen.vue`, `README.md`, `DEVELOPMENT.md`, `e2e/add-to-session.spec.ts`
- Test: `src/ui/exports.test.ts`

**Interfaces:**
- Produces: `evergreenStale(s: Pick<SessionState, "exports" | "imports">): boolean`: there is an Evergreen download, and the latest one is earlier than the latest `imported` record.

**Exact copy:**

- Export section (`data-testid="evergreen-stale"`): `Items were added after the last Evergreen download. The new file contains every checkout in the session, so upload only one of them unless the earlier one was never uploaded.`
- Close dialog, after the current text: `This can't be undone. Stopping for the day? Use Exit session instead, and resume tomorrow.`, with **Exit session** in bold.

- [ ] **Step 1: Write the failing tests**

```ts
// exports.test.ts
it("is stale when an import follows the last Evergreen download", ...);
it("isn't stale with no download, no import, or a later download", ...);
it("only Evergreen downloads count", ...);       // a later CSV doesn't clear it
// e2e/add-to-session.spec.ts
test("an import after the Evergreen download warns, until the next download", async ({ page }) => {
  // Download Evergreen, add a file. The stale line shows. On a closed session, the delete dialog
  // shows "Download the Evergreen file first". Download again: both are gone.
});
test("the Close dialog points to Exit session", ...);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vp test run src/ui/exports.test.ts && npm run build && npx playwright test e2e/add-to-session.spec.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the warnings and copy**

In `SummaryScreen.vue`, `evergreenExported` becomes "has an Evergreen download and isn't stale".

- [ ] **Step 4: Update the docs**

**README.md:**

- Add step 6 **Combining sessions**, and renumber **Deleting a closed session** to 7. Cover: when to use it (an outage spanning sessions); prefer another session on this PC and use files for one on another PC or deleted; prefer Excel or Evergreen over CSV; PDFs can't be added; an Evergreen file has no clerk names; an addition can't be undone, so check the preview, and after a wrong addition start a new session and add the right sources; export after the last scan or void; how to avoid a double upload.
- In step 5, **When the system is back**, add the close advice: Close can't be undone; to stop for the day use **Exit session** and resume tomorrow.

**DEVELOPMENT.md:**

- The new record types and `imported` flag.
- The rewrite and gap rule, including why gaps can't be left out.
- The section 5 rule: a `deviceId` carrying `imported` isn't a PC.
- The hand-written XML scanner and why.
- Mixed versions: a release before this one rejects these records, so its peers keep getting them resent every 10 seconds. All desks must run the same version, as already required.

- [ ] **Step 5: Run every check**

Run: `npx vp check && npx vp test run && npm run e2e`
Expected: all pass.

- [ ] **Step 6: Commit** with "Warn about stale Evergreen files, explain closing, and document combining sessions".

- [ ] **Step 7: Note for the PR the by-hand checks from the spec**

These can't run here: an Excel file saved by real Excel loads, a CSV saved by real Excel is refused, and the combined file is checked in an Evergreen test system if one is available. List them unticked in the PR's test plan.
