import { strToU8, zipSync } from "fflate";
import { expect, test } from "vite-plus/test";
import { buildXlsx, excelDate } from "../export/xlsx";
import type { ExportRow } from "../export/rows";
import { mk } from "../log/helpers.test-util";
import { reduce } from "../log/reduce";
import { readImportFile } from "./read";
import { RejectFile } from "./rows";
import { fromExcelDate, parseXlsx } from "./xlsx";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

interface Pkg {
  sheets?: { name: string; id: string; target: string }[];
  parts?: Record<string, string>;
  workbookPr?: string;
}

function pkg(p: Pkg): Uint8Array {
  const sheets = p.sheets ?? [{ name: "Items", id: "rId1", target: "worksheets/sheet1.xml" }];
  const files: Record<string, string> = {
    "xl/workbook.xml":
      `<workbook ${NS} ${R}>${p.workbookPr ?? ""}<sheets>` +
      sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="${s.id}"/>`).join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map((s) => `<Relationship Id="${s.id}" Type="x/worksheet" Target="${s.target}"/>`)
        .join("") +
      "</Relationships>",
    ...p.parts,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const sheet = (rows: string) => `<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
const t = (ref: string, s: string) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
const n = (ref: string, v: number) => `<c r="${ref}"><v>${v}</v></c>`;
const HEADER =
  `<row r="1">` +
  ["Patron", "Item", "Scanned at", "Clerk", "Workstation", "Session"]
    .map((h, i) => t(`${"ABCDEF"[i]}1`, h))
    .join("") +
  "</row>";
const one = (rows: string, extra: Pkg = {}) =>
  pkg({ ...extra, parts: { "xl/worksheets/sheet1.xml": sheet(HEADER + rows), ...extra.parts } });
const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RejectFile) return e.message;
    throw e;
  }
  return "accepted";
};

const exportRow = (over: Partial<ExportRow> = {}): ExportRow => ({
  patron: "0012",
  item: "0034",
  scannedAt: new Date(2026, 9, 31, 12, 34, 56).getTime(),
  clerk: "Ann",
  workstation: "Desk 1",
  session: "S",
  ...over,
});

test("round-trips buildXlsx", () => {
  const s = reduce([mk("a", 1, { type: "session-created", name: "S" })]);
  const rows = [exportRow(), exportRow({ patron: "0099", item: "", scannedAt: null })];
  const got = parseXlsx(buildXlsx(s, rows, new Date(2026, 10, 1)) as Uint8Array);
  expect(got).toEqual(rows.map(({ session: _s, ...r }, i) => ({ ...r, rowNumber: i + 2 })));
});

test("reads shared strings, including rich text runs and skipping phonetic rPh", () => {
  const sst =
    `<sst ${NS}><si><t>P1</t></si><si><r><t>I</t></r><r><rPr/><t>1</t></r>` +
    `<rPh sb="0" eb="1"><t>ignored</t></rPh></si><si><t>Ann</t></si></sst>`;
  const bytes = one(
    `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c>${n("C2", 46326.5)}` +
      `<c r="D2" t="s"><v>2</v></c></row>`,
    { parts: { "xl/sharedStrings.xml": sst } },
  );
  expect(parseXlsx(bytes)).toEqual([
    {
      patron: "P1",
      item: "I1",
      scannedAt: new Date(2026, 9, 31, 12, 0, 0).getTime(),
      clerk: "Ann",
      workstation: "",
      rowNumber: 2,
    },
  ]);
});

test("finds columns from cell references when empty cells are omitted", () => {
  const bytes = one(
    `<row r="2">${t("A2", "P1")}${t("B2", "I1")}${n("C2", 46326.5)}${t("E2", "Desk 1")}</row>`,
  );
  expect(parseXlsx(bytes)[0]).toMatchObject({ clerk: "", workstation: "Desk 1" });
});

test("finds Items through the workbook when sheets are reordered", () => {
  const rows = `<row r="2">${t("A2", "P1")}</row>`;
  for (const target of ["worksheets/sheet2.xml", "/xl/worksheets/sheet2.xml"]) {
    const bytes = pkg({
      sheets: [
        { name: "Summary", id: "rId5", target: "worksheets/sheet1.xml" },
        { name: "Items", id: "rId7", target },
      ],
      parts: {
        "xl/worksheets/sheet1.xml": sheet(`<row r="1">${t("A1", "Session")}</row>`),
        "xl/worksheets/sheet2.xml": sheet(HEADER + rows),
      },
    });
    expect(parseXlsx(bytes)).toHaveLength(1);
  }
});

test("rejects numeric Patron and Item cells", () => {
  expect(reasonOf(() => parseXlsx(one(`<row r="2">${n("A2", 12)}</row>`)))).toBe(
    "Row 2: Patron is a number, so Excel may have changed it.",
  );
  expect(reasonOf(() => parseXlsx(one(`<row r="3">${t("A3", "P")}${n("B3", 12)}</row>`)))).toBe(
    "Row 3: Item is a number, so Excel may have changed it.",
  );
});

test("rejects a Scanned at serial outside Excel's range, or a boolean", () => {
  const bad = "Row 2: Scanned at is not a date.";
  for (const cell of [
    n("C2", 21234567890123),
    n("C2", -1),
    n("C2", 2958466),
    '<c r="C2" t="b"><v>1</v></c>',
  ]) {
    expect(reasonOf(() => parseXlsx(one(`<row r="2">${t("A2", "P")}${cell}</row>`)))).toBe(bad);
  }
  const bytes = one(`<row r="2">${t("A2", "P")}${n("C2", 21234567890123)}</row>`);
  expect(reasonOf(() => parseXlsx(bytes))).toBe(bad);
  expect(
    Number.isFinite(
      parseXlsx(one(`<row r="2">${t("A2", "P")}${n("C2", 46000.5)}</row>`))[0]!.scannedAt,
    ),
  ).toBe(true);
});

test("rejects text in Scanned at, but allows it empty", () => {
  expect(
    reasonOf(() => parseXlsx(one(`<row r="2">${t("A2", "P")}${t("C2", "yesterday")}</row>`))),
  ).toBe("Row 2: Scanned at is not a date.");
  expect(parseXlsx(one(`<row r="2">${t("A2", "P")}<c r="C2"/></row>`))[0]!.scannedAt).toBeNull();
});

test("rejects a missing Items sheet, wrong headers and date1904", () => {
  const noItems = pkg({
    sheets: [{ name: "Other", id: "rId1", target: "worksheets/sheet1.xml" }],
    parts: { "xl/worksheets/sheet1.xml": sheet(HEADER) },
  });
  expect(reasonOf(() => parseXlsx(noItems))).toBe("This Excel file has no Items sheet.");
  const wrong = pkg({
    parts: {
      "xl/worksheets/sheet1.xml": sheet(`<row r="1">${t("A1", "Patron")}${t("B1", "Book")}</row>`),
    },
  });
  expect(reasonOf(() => parseXlsx(wrong))).toBe("This Excel file's columns don't match an export.");
  expect(reasonOf(() => parseXlsx(one("", { workbookPr: '<workbookPr date1904="1"/>' })))).toBe(
    "This Excel file uses the 1904 date system.",
  );
});

test("skips rows with no cells", () => {
  const bytes = one(`<row r="2"/><row r="3">${t("A3", "P1")}</row>`);
  expect(parseXlsx(bytes).map((r) => r.rowNumber)).toEqual([3]);
});

test("refuses a part over the limit", () => {
  expect(reasonOf(() => parseXlsx(one(""), { maxPartBytes: 10 }))).toBe(
    "This Excel file is too large to read.",
  );
});

test("only inflates the parts it needs", () => {
  const bytes = one("", { parts: { "xl/media/huge.bin": "x".repeat(100_000) } });
  expect(parseXlsx(bytes, { maxPartBytes: 5000 })).toEqual([]);
});

test("a zip with no workbook, or that is not a zip, is not an export", () => {
  const unknown = "This isn't a file exported by Offline Checkout.";
  const now = Date.now();
  const noBook = zipSync({ "a.txt": strToU8("hi") });
  expect(readImportFile("a.xlsx", noBook, now)).toEqual({ name: "a.xlsx", reason: unknown });
  const broken = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
  expect(readImportFile("b.xlsx", broken, now)).toEqual({ name: "b.xlsx", reason: unknown });
});

test("readImportFile reads an exported workbook as xlsx", () => {
  const s = reduce([mk("a", 1, { type: "session-created", name: "S" })]);
  const at = new Date(2026, 9, 31, 12, 34, 56).getTime();
  const bytes = buildXlsx(
    s,
    [exportRow({ patron: "P1", item: "I1", scannedAt: at })],
    new Date(),
  ) as Uint8Array;
  const got = readImportFile("a.xlsx", bytes, Date.now());
  expect(got).toMatchObject({ kind: "file", format: "xlsx" });
  expect("rows" in got && got.rows[0]!.scannedAt).toBe(at);
});

test("fromExcelDate inverts excelDate", () => {
  for (const ms of [
    new Date(2026, 9, 31, 12, 34, 56).getTime(),
    new Date(2026, 0, 1, 0, 0, 0).getTime(),
    new Date(2026, 2, 8, 23, 59, 59).getTime(),
  ]) {
    expect(fromExcelDate(excelDate(ms))).toBe(ms);
  }
});
