import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vite-plus/test";
import { reduce } from "../log/reduce";
import { mk } from "../log/helpers.test-util";
import { exportRows } from "./rows";
import { buildXlsx, excelDate } from "./xlsx";

test("excelDate uses local wall-clock time", () => {
  expect(excelDate(new Date(2026, 9, 31, 12, 0, 0).getTime())).toBe(46326.5);
});

test("workbook has Items and Summary sheets with text barcodes, dates and totals", () => {
  const s = reduce([
    mk("a", 1, { type: "session-created", name: "A & B <desk>" }),
    mk("a", 2, { type: "patron-started", patron: "0012" }),
    mk("a", 3, { type: "item-scanned", visitId: "a:2", item: "-5" }),
  ]);
  const files = unzipSync(buildXlsx(s, exportRows(s), new Date(2026, 9, 31, 12, 0, 0)));
  expect(Object.keys(files).sort()).toEqual([
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ]);
  expect(strFromU8(files["xl/workbook.xml"]!)).toContain('<sheet name="Items"');

  const items = strFromU8(files["xl/worksheets/sheet1.xml"]!);
  expect(items).toContain('state="frozen"');
  expect(items).toContain(
    '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Patron</t></is></c>',
  );
  expect(items).toContain(
    '<c r="A2" s="3" t="inlineStr"><is><t xml:space="preserve">0012</t></is></c>',
  );
  expect(items).toContain('<t xml:space="preserve">-5</t>');
  expect(items).toContain(`<c r="C2" s="2"><v>${excelDate(3000)}</v></c>`);
  expect(items).toContain('<t xml:space="preserve">A &amp; B &lt;desk&gt;</t>');

  const summary = strFromU8(files["xl/worksheets/sheet2.xml"]!);
  expect(summary).toContain(
    '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Session</t>',
  );
  expect(summary).toContain('<c r="B2" s="2"><v>46326.5</v></c>');
  expect(summary).toContain('<c r="B3"><v>1</v></c>');
  expect(summary).toContain('<c r="A7" s="3" t="inlineStr"><is><t xml:space="preserve">A</t>');
});
