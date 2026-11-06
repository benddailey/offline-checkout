import { expect, test } from "vite-plus/test";
import { buildCsv } from "../export/csv";
import type { ExportRow } from "../export/rows";
import { buildXacts } from "../export/xacts";
import { MAX_FILE_BYTES, readImportFile, readImportFiles } from "./read";
import type { FileRejection, FileSource } from "./rows";

const now = new Date(2026, 10, 6, 12, 0, 0).getTime();
const enc = (s: string) => new TextEncoder().encode(s);
const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  patron: "P1",
  item: "I1",
  scannedAt: now - 60_000,
  clerk: "Ann",
  workstation: "Desk 1",
  session: "S",
  ...over,
});
const csv = (...rows: ExportRow[]) => enc(buildCsv(rows));
const reason = (r: FileSource | FileRejection) => ("reason" in r ? r.reason : "accepted");

test("detects by content, not extension", () => {
  const a = readImportFile("export.txt", csv(row()), now);
  expect(a).toMatchObject({ kind: "file", name: "export.txt", format: "csv" });
  const b = readImportFile("pending.csv", enc(buildXacts([row()])), now);
  expect(b).toMatchObject({ kind: "file", format: "xacts" });
});

test("gives the PDF reason and refuses unknown or empty files", () => {
  expect(reason(readImportFile("a.pdf", enc("%PDF-1.7 ..."), now))).toBe(
    "A PDF can't be added because it has no scan times. Use the Excel or Evergreen file.",
  );
  const unknown = "This isn't a file exported by Offline Checkout.";
  expect(reason(readImportFile("a.txt", enc("hello"), now))).toBe(unknown);
  expect(reason(readImportFile("a.csv", new Uint8Array(), now))).toBe(unknown);
  expect(reason(readImportFile("a.zip", new Uint8Array([0x50, 0x4b, 3, 4, 0]), now))).toBe(unknown);
});

test("refuses files over the limit", () => {
  expect(reason(readImportFile("big.csv", new Uint8Array(MAX_FILE_BYTES + 1), now))).toBe(
    "This file is over 50 MB.",
  );
});

test("rejects scientific notation and accepts 12E5", () => {
  expect(reason(readImportFile("a.csv", csv(row({ item: "1.23E+13" })), now))).toBe(
    'Row 2: "1.23E+13" looks like a number Excel changed.',
  );
  const ok = readImportFile("a.csv", csv(row({ item: "12E5" })), now);
  expect(ok).toMatchObject({ kind: "file" });
});

test("rejects a control code, a bad barcode, an item with no time, a future time", () => {
  expect(reason(readImportFile("a.csv", csv(row(), row({ item: "OC-END" })), now))).toBe(
    'Row 3: "OC-END" is a reserved control code',
  );
  expect(reason(readImportFile("a.csv", csv(row({ patron: "p é" })), now))).toMatch(
    /^Row 2: Contains characters/,
  );
  expect(reason(readImportFile("a.csv", csv(row({ scannedAt: null })), now))).toBe(
    "Row 2: the item has no time.",
  );
  expect(reason(readImportFile("a.csv", csv(row({ scannedAt: now + 25 * 3600_000 })), now))).toBe(
    "Row 2: the time is more than a day in the future.",
  );
  const x = buildXacts([row({ item: "OC-VOIDLAST" })]);
  expect(reason(readImportFile("p.xacts", enc(x), now))).toBe(
    'Line 1: "OC-VOIDLAST" is a reserved control code',
  );
});

test("accepts a time less than a day ahead", () => {
  const r = readImportFile("a.csv", csv(row({ scannedAt: now + 23 * 3600_000 })), now);
  expect(r).toMatchObject({ kind: "file" });
});

test("is all or nothing", () => {
  const r = readImportFile("a.csv", csv(row(), row({ item: "bad item" }), row()), now);
  expect(r).toEqual({ name: "a.csv", reason: expect.stringMatching(/^Row 3:/) });
  expect("rows" in r).toBe(false);
});

test("a blank-item row with no time is accepted", () => {
  const r = readImportFile("a.csv", csv(row({ item: "", scannedAt: null })), now);
  expect(r).toMatchObject({ kind: "file", rows: [{ patron: "P1", item: "", scannedAt: null }] });
});

test("readImportFiles rejects only the unreadable file", async () => {
  const gone = {
    name: "folder",
    size: 0,
    arrayBuffer: () => Promise.reject(new Error("NotFound")),
  } as unknown as File;
  const good = new File([csv(row())], "good.csv");
  const out = await readImportFiles([gone, good], now);
  expect(out[0]).toEqual({ name: "folder", reason: "This file could not be read." });
  expect(out[1]).toMatchObject({ kind: "file", name: "good.csv", format: "csv" });
});
