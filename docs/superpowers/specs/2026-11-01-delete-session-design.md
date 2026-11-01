# Delete closed sessions, and record exports

## Goal

Staff can remove old sessions. **Delete session** is on the Summary page of closed sessions only. It
removes the session from this workstation and from every workstation that has the session open and
connected at that moment. Workstations that are not connected keep their copy; staff delete it there
if they want to. Before deleting, the dialog says which exports were made, so a session whose
Evergreen file was never downloaded is not lost by mistake.

## 1. Export log

- New record type `{ type: "exported"; kind: "pdf" | "csv" | "xlsx" | "xacts" }`, appended after
  `generatePdf` or `exportTable` has handed the file to the browser. Like other records it carries
  `employee`, `workstation` and `at`, and syncs to peers. It is allowed after the session is closed.
- `isLogRecord` accepts it only with one of the four kinds.
- `reduce` collects them into `SessionState.exports` (`{ kind, at, employee, workstation }[]`, in
  record order). They change no totals.
- `listSessions`' last activity counts them like any record. The PDF and the CSV, Excel and
  Evergreen files ignore them.
- Sessions exported before this version have no export records. The dialog says "No … download
  recorded", not "never downloaded".

## 2. Delete on this workstation

- Summary, closed sessions only: a **Delete session** section under the exports, with a red
  **Delete session** button.
- It opens an alert dialog, which reuses the Summary dialog's focus trap and Escape handling:
  - title **Delete session**;
  - "This removes the session from this workstation and from all connected workstations. It cannot
    be undone.";
  - one line per export kind: "Evergreen file: downloaded 3:12 PM by Ann (Front desk)". Only the
    latest of each kind is shown. A kind never exported says "No Evergreen file download recorded";
  - when no Evergreen file was downloaded, an extra red line: "Download the Evergreen file first if
    these checkouts are not in Evergreen yet.";
  - when workstations in the session are not connected: "Not connected: Back desk. It keeps its
    copy." This uses the existing `notConnected` list;
  - a **slide to delete** control and **Cancel**. Cancel has focus when the dialog opens.
- On confirm, `session.deleteSession()`:
  1. sends `{ t: "delete-session" }` to each connected peer and waits for each peer's
     `{ t: "deleted" }` reply, at most 3 seconds. Closing the mesh at once could drop the message,
     because closing a link closes its peer connection;
  2. tears the session down (mesh, store, lock), then `db.deleteSession(sessionId)` removes the
     index entry and deletes the `oc-session-<id>` database;
  3. goes to the start page with the notice "Session ‘Outage’ deleted." When a connected peer did
     not reply in time, the notice adds "Not confirmed on: Back desk."

## 3. Delete arriving from a peer

- The session store subscribes to mesh messages. On `{ t: "delete-session" }` it acts only if the
  session is closed here. If it isn't, it ignores the message, so a delete can never remove an open
  session.
- Otherwise it replies `{ t: "deleted" }`, then tears down, deletes the session the same way, and
  shows the start page with the notice "Session ‘Outage’ was deleted on Front desk."
- `SyncEngine` already ignores messages it does not know, and these two are not sync messages.

## 4. Slide to delete

`src/ui/components/SlideToConfirm.vue`, built by hand, with no new dependency.

- A track with a handle and the label "Slide to delete". Dragging the handle (pointer events, with
  pointer capture) to within 8 px of the end emits `confirm`. Releasing earlier snaps it back.
- Keyboard: the handle is focusable with `role="slider"`, `aria-valuemin` 0, `aria-valuemax` 100,
  `aria-valuenow`, and `aria-valuetext` such as "Slide to delete, 40%". Right and Up move it 20%,
  Left and Down move it back, Home resets it, and End or reaching 100% confirms.
- Enter and Space do nothing, so a scanner's Enter cannot confirm. Focus starts on Cancel.
- The dialog's focus trap includes the slider: it traps buttons and `[role=slider]`.

## 5. Not changed

- The pairing payload: `OC2:` stays.
- All workstations must still run the same version. An older peer would reject `exported` records
  and ignore `delete-session`.
- The start page's closed-session list has no delete. Deleting from there would need the session
  opened anyway, and the request was for the Summary page only.

## Tests

- Unit:
  - `validate`: `exported` with each kind, and a bad kind rejected;
  - `reduce`: exports collected, totals unchanged;
  - `db.deleteSession`: database and index entry gone, other sessions untouched;
  - session store:
    - export recorded after PDF and table downloads, and not when the download fails;
    - `deleteSession` waits for replies, with a timeout;
    - an incoming delete is ignored for an open session and acted on for a closed one;
  - `SlideToConfirm`: keyboard steps, End confirms, Enter ignored, early release resets.
- e2e (`e2e/delete-session.spec.ts`):
  - two paired workstations scan and close, and A downloads the Evergreen file;
  - B's dialog shows A's Evergreen download;
  - B slides to delete, and both start pages lose the session; A shows "was deleted on …";
  - a session open on the scan screen has no Delete button.
- Docs: README (deleting, and that desks not connected keep their copy), DEVELOPMENT (the
  `exported` record and the delete messages).
