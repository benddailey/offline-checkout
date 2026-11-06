import { expect, test } from "vite-plus/test";
import { buildCsv } from "../export/csv";
import type { ExportRow } from "../export/rows";
import { isCsvHeader, parseCsv } from "./csv";

const at = new Date(2026, 9, 31, 14, 5, 12).getTime();
const header = "Patron,Item,Scanned at,Clerk,Workstation,Session";
const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  patron: "P1",
  item: "I1",
  scannedAt: at,
  clerk: "Ann",
  workstation: "Desk 1",
  session: "S",
  ...over,
});

test("round-trips buildCsv", () => {
  const rows = [
    row({ clerk: 'Ann "A", Jr', workstation: "Front\nDesk" }),
    row({ patron: "P2", item: "", scannedAt: null, clerk: "Bob", workstation: "" }),
  ];
  const out = parseCsv(buildCsv(rows));
  expect(out).toEqual([
    {
      rowNumber: 2,
      patron: "P1",
      item: "I1",
      scannedAt: at,
      clerk: 'Ann "A", Jr',
      workstation: "Front\nDesk",
    },
    { rowNumber: 3, patron: "P2", item: "", scannedAt: null, clerk: "Bob", workstation: "" },
  ]);
  expect(isCsvHeader(buildCsv(rows))).toBe(true);
});

test("removes only the ' that guard adds", () => {
  const out = parseCsv(buildCsv([row({ item: "-123", clerk: "'Tis" })]));
  expect(out[0].item).toBe("-123");
  expect(out[0].clerk).toBe("'Tis");
});

test("accepts LF and no BOM", () => {
  const out = parseCsv(`${header}\nP1,I1,2026-10-31 14:05:12,Ann,Desk 1,S\n`);
  expect(out).toHaveLength(1);
  expect(out[0].scannedAt).toBe(at);
  expect(isCsvHeader(`${header}\n`)).toBe(true);
  expect(isCsvHeader("a,b\n")).toBe(false);
});

test("rejects Excel's rewritten time", () => {
  expect(() => parseCsv(`${header}\nP1,I1,11/6/2026 14:05,Ann,Desk 1,S\n`)).toThrow(
    "Row 2: the time was changed, probably by Excel saving this CSV, and barcodes may be damaged too. Use the original file, the Excel file or the Evergreen file.",
  );
});

test("rejects 2026-02-31 and a wrong column count", () => {
  expect(() => parseCsv(`${header}\nP1,I1,2026-02-31 10:00:00,Ann,Desk 1,S\n`)).toThrow(
    /^Row 2: the time was changed/,
  );
  expect(() => parseCsv(`${header}\nP1,I1,,Ann,Desk 1,S\nP1,I1,2026-10-31 10:00:00\n`)).toThrow(
    /^Row 3:/,
  );
});
