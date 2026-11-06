# Add to session: combine sessions and exported files

## Goal

An outage can span several sessions. For example, staff close Friday's session expecting a fix, start
another on Saturday, and on Monday want one Evergreen upload. From the Summary, staff can add another
session on this PC, or CSV, Excel and Evergreen files exported by the app, to the session they have
open. The session then holds everything in time order, and any export covers all of it.

Success: Friday and Saturday combine into one Evergreen file with each checkout once, at its original
scan time, and every workstation in the session ends up with the same result.

## Decisions

- **Two sources.** Another session on this PC is the better source because it copies the real log.
  Files are the fallback, for a session that is on another PC or has been deleted.
- **PDF is not accepted.** It has no scan times. Dropping one gives a clear message.
- **Open and closed sessions can both receive additions.** Monday's combine will often be into a
  session that is already closed. The session stays open or closed as it was.
- **Sources are left alone.** Friday's session is not changed or deleted. Staff delete it as usual.
- **Imports are permanent.** The log is append-only, so there is no undo. The preview is the safeguard.
  After a wrong addition, staff start a new session and add the right sources to it.
- **No Reopen session button**, for the reasons below the design (section 8).
- **No schema migration and no pairing code change.** Records are unstructured values in IndexedDB,
  and the pairing payload does not change, so the prefix stays `OC3:`.

## 1. Log changes

`src/log/types.ts`, `validate.ts`, `reduce.ts`:

- New optional envelope field `imported?: true` on records that did not come from a workstation in
  this session. `isLogRecord` accepts only `true` or absent. It is a flag, not a time, because the same
  record can be copied on two PCs and `reduce` must depend only on the set of records.
- New record `{ type: "imported"; source: "session" | "file"; name: string; patrons: number; items: number }`.
  One per source, written by the real workstation with the clerk who confirmed the import. `name` is the
  session or file name (clamped to `MAX_NAME`). `patrons` and `items` are what that source added. A
  source that changes nothing writes no record.
- New record `{ type: "import-gap" }`, a placeholder that `reduce` ignores (see section 2).
- `reduce` collects `SessionState.imports`, like `exports`. `VisitState` gains `imported: boolean`.
- Sorting is unchanged: `reduce` orders by `at`, and `blocksFromState` merges each patron's visits and
  keeps a barcode's earliest scan. That is the combining and sorting the exports need.

## 2. Adding another session

A record is keyed by `(deviceId, seq)`, and the same PC has the same `deviceId` in both sessions, so
records cannot be copied as they are: they would collide. `src/import/session.ts` rewrites each one:

- `deviceId` becomes `mergedDeviceId(sourceSessionId, deviceId)`: SHA-256 of both, as 10 base-36
  characters. `visitId` and `target` references are rewritten the same way, so voids stay attached.
- `seq`, `at`, `employee` and `workstation` are kept. `sessionId` becomes this session's.
  `imported: true` is set.
- `session-created`, `session-closed`, `exported` and `imported` records become `import-gap`. Copied
  as they are, they would rename or close this session. They cannot be left out, because `vectorOf`
  stops at the first missing `seq`, and a gap would make peers resend that device's later records every
  10 seconds for the life of the session.

Because the ids are derived, adding a session twice stores nothing new, and adding it again after
more scans stores only the new records. Two PCs adding the same session produce the same records, which
sync cleanly. The source is read through a new read-only `db.readRecords(sessionId)`, which takes no
lock, so it also works if the source is open in another tab. If the source is still open, the preview
says later scans there need adding again.

## 3. Adding files

`src/import/` turns a file into rows, then rows into records.

**Detection is by content, not extension:** a zip is Excel, a first line starting with `{` is Evergreen,
a header equal to `COLUMNS` is CSV, and `%PDF` gets the PDF message. Anything else is rejected.

**A file is accepted whole or not at all,** with the reason and first bad row shown. A partly imported
file would look complete while missing checkouts. Files over 50 MB are refused, and the Excel reader
extracts only the parts it needs, refusing any part over 200 MB.

| Format | Reading | Rejected when |
| --- | --- | --- |
| Evergreen | One JSON object per line. Time from `checkout_time`. Clerk `Imported`, no workstation. | `type` is not `checkout`, or `timestamp` and `checkout_time` differ by more than a second |
| CSV | RFC 4180, BOM optional, CRLF or LF. Removes the `'` that `guard` adds. | Header differs, or the time is not exactly `YYYY-MM-DD HH:MM:SS` |
| Excel | `Items` sheet found through the workbook, so re-saved files work. Reads inline and shared strings, and finds columns from cell references because Excel omits empty cells. Date serial converted back to local time. | Patron or Item is a number cell, or Scanned at is not a number |

All formats also reject: a barcode that fails `validateBarcode`; a barcode in scientific notation (such
as `1.23E+13`, which `BARCODE_TEXT` would otherwise allow); a control code; an item with no time; a time
more than a day in the future.

The strict CSV time doubles as a check for damage. When Excel saves a CSV it normally rewrites the time
as `11/6/2026 14:05`, and that same save is what drops leading zeros, so such a file is refused with a
message pointing to the original file, the Excel file or the Evergreen file.

**Rows to records**, in `src/import/plan.ts`:

- Each file gets a fresh random `deviceId`, with `seq` from 1 and no gaps.
- Files in one batch are combined first. For the same patron and item, the row with clerk details
  wins over one without, then the earliest.
- A row is **already here** if that patron and item is live in the session. Exports already show a
  pair once, so the time doesn't need to match.
- A row is **voided here** if that patron and item is only voided in the session. It is not added,
  so an export from before a void can't bring the item back.
- Each patron in a file becomes one `patron-started` (at the earliest row), its `item-scanned` records
  with each row's time, clerk and workstation, and one `patron-ended`. A patron row with no items
  becomes a visit with no items, unless that patron is already in the session.

## 4. Saving

New `SessionStore.importRecords(records, audits)` writes everything in one strict transaction: the
copied records as `put` would, skipping existing keys, plus the `imported` records through `nextSeq`
under the name the clerk entered. It does not change the session's current clerk. A failure leaves the
session untouched and shows an error, but is not fatal, because scanning is unaffected.

`session.addToSession()` runs through the existing `enqueue`, so it can't interleave with scans. It
calls `merge()` once with all the new records. Peers receive them through the existing vector exchange,
within about 10 seconds; records aren't pushed one by one.

## 5. Imported devices are not workstations

The made-up devices must be left out wherever a `deviceId` is taken to mean a real PC:

| Where | If left in |
| --- | --- |
| `knownDevices` (`mesh.reconnect`) | The mesh tries to dial a device that doesn't exist, every 10 seconds |
| `notConnected` | False "Not connected" warnings and export prompts |
| `disconnected` | A solo PC reports being disconnected |
| `othersInProgress` | An unfinished visit in a source appears as a patron in progress |
| `readLog` workstations | The made-up device appears under **Other workstations** |

## 6. Summary page

A new **Add to this session** card (`src/ui/components/AddToSession.vue`), available on open and closed
sessions, with:

- **Add another session**, listing the other sessions on this PC with name, start time and open or
  closed;
- a drop zone and **Choose files** for multiple files. As on the pairing screen, a file dropped
  elsewhere on the Summary is blocked, so it can't open in the tab and leave the app.

Choosing a source opens a preview dialog. `ScanInput` pauses while it is open. The dialog reuses the
Summary's focus trap and Escape handling, and shows:

- each source with its type, date range and what it adds: "Adds 118 patrons and 240 items. 6 already
  here. 2 voided here, not added.";
- rejected files with their reasons, and a note that the other files can still be added;
- warnings, when they apply:
  - **Double upload**, always: "If any of these checkouts are already in Evergreen, the new Evergreen
    file would check them out again." When a source session recorded an Evergreen download, it also says
    who and when;
  - an item also on another patron, with the count, matching the scan warning;
  - an Evergreen file adds no clerk or workstation, so its items count under **Imported**;
  - a source session is still open;
- a required **Your name** field, always empty at first, as clerk fields are everywhere;
- **Add to session** (disabled until there is a name and something to add) and **Cancel**. When nothing
  is new, the dialog says so and offers only **Close**.

After adding, a banner gives the totals added and an **Added to this session** list shows each source:
"friday.xlsx: 118 patrons, 240 items, added 9:02 AM by Ann (Front desk 1)".

**Stale export warnings.** An Evergreen download earlier than the latest `imported` record no longer
counts as done:

- the Export section shows: "Items were added after the last Evergreen download. The new file contains
  every checkout in the session, so upload only one of them unless the earlier one was never uploaded.";
- the delete dialog shows its existing red "Download the Evergreen file first" line.

## 7. Clearer closing advice

The Close dialog adds: "This can't be undone. Stopping for the day? Use **Exit session** instead, and
resume tomorrow." README.md explains the same in **When the system is back**.

## 8. Why no Reopen session

Closing is per-session state that syncs. Reopening would need a rule for a PC that closes while another
reopens, and for a closed copy on a PC that was offline. Adding a session covers the need.

## 9. Known limits

- A CSV changed by another tool that keeps the exact time format could still have damaged barcodes. The
  app can't detect that. The README recommends the Excel or Evergreen file.
- An export made before a void, from a session that is no longer available, can't be recognized as
  stale. The README says to export after the last scan or void.
- Only the app's own exports are supported. A file saved by Evergreen's offline page is rejected if it
  has any line that isn't a `checkout` with the fields the app writes.
- CSV and Excel times are read in this PC's time zone. The repeated hour when clocks go back is
  ambiguous and resolves to the first.
- When the same item is on a patron in both sessions, **By clerk** can add up to more than the total.
  The total and exports count it once. `reduce` already behaves this way for duplicate scans on
  different visits, so this isn't changed here.
- Two PCs each importing the same file separately create separate devices. Exports still show each
  checkout once, but **By clerk** counts can be inflated. Adding a session doesn't have this problem.

## 10. Docs

- **README.md:** a new **Combining sessions** step: when to use it, which source to prefer, how to avoid a
  double upload, and that an Evergreen file has no clerk names.
- **DEVELOPMENT.md:** the record changes, the rewrite and gap rule in section 2, and the rule in section 5.

## 11. Testing

**Unit (Vitest):**

- Each parser round-trips the output of `buildCsv`, `buildXlsx` and `buildXacts`.
- Excel variants: shared strings, omitted empty cells and reordered sheets, using hand-built fixtures.
- Each rejection: Excel-style date, scientific notation, numeric cell, other Evergreen transaction types,
  PDF, unknown file, bad barcode, control code, future time.
- Rewriting: no key collisions on the same PC, voids stay attached, source `session-closed` doesn't close
  the session and `session-created` doesn't rename it.
- Adding a session twice stores nothing. Adding after more scans stores only those.
- `vectorOf` gives the full `seq` for a rewritten device, and `sim.test.ts` shows a peer converging on
  the same state without repeat sends.
- Dedupe across files, already here and voided here.
- Each row of the section 5 table.
- `importRecords` rolls back completely on failure.

**End to end (Playwright):**

- Friday's session closed, Saturday's open: add Friday, then check the Summary totals and the decoded
  Evergreen file for each checkout once with its original time.
- Export Excel, CSV and Evergreen files from a session, drop all three into another: each checkout once.
- Two paired workstations: an import on one reaches the other, with no "Not connected" entry.
- Adding into a closed session, which stays closed.
- A file dropped outside the zone doesn't navigate away.

**By hand before release:** an Excel file saved by real Excel loads, a CSV saved by real Excel is refused,
and the combined file is checked in an Evergreen test system if one is available.
