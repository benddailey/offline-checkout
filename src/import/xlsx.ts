import { strFromU8, unzipSync } from "fflate";
import { COLUMNS } from "../export/rows";
import { RejectFile, type NumberedRow } from "./rows";
import { scanXml } from "./xml";

export const MAX_PART_BYTES = 200 * 1024 * 1024;

const UNKNOWN = "This isn't a file exported by Offline Checkout.";
const WORKBOOK = "xl/workbook.xml";
const RELS = "xl/_rels/workbook.xml.rels";
const SHARED = "xl/sharedStrings.xml";
/** 31 December 9999, the last date Excel accepts. */
const MAX_SERIAL = 2_958_465;

/** Inverse of `excelDate`: the serial's wall clock, to the second, as a local time. */
export function fromExcelDate(serial: number): number {
  const wall = new Date(Math.round((serial - 25_569) * 86_400) * 1000);
  return new Date(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  ).getTime();
}

function inflate(bytes: Uint8Array, names: string[], limit: number): Record<string, Uint8Array> {
  let tooLarge = false;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        if (!names.includes(f.name)) return false;
        if (f.originalSize > limit) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new RejectFile(UNKNOWN);
  }
  if (tooLarge) throw new RejectFile("This Excel file is too large to read.");
  return parts;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function readWorkbook(xml: string): { itemsId: string | null; date1904: boolean } {
  let itemsId: string | null = null;
  let date1904 = false;
  scanXml(xml, {
    open(name, attrs) {
      if (name === "sheet" && attrs.name === "Items") itemsId = attrs.id ?? null;
      if (name === "workbookPr") date1904 = attrs.date1904 === "1" || attrs.date1904 === "true";
    },
    text() {},
    close() {},
  });
  return { itemsId, date1904 };
}

function targetFor(xml: string, id: string): string | null {
  let target: string | null = null;
  scanXml(xml, {
    open(name, attrs) {
      if (name === "Relationship" && attrs.Id === id) target = attrs.Target ?? null;
    },
    text() {},
    close() {},
  });
  if (target === null) return null;
  const t: string = target;
  return t.startsWith("/") ? t.slice(1) : `xl/${t}`;
}

function readSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let current = "";
  let inT = false;
  let phonetic = 0;
  scanXml(xml, {
    open(name) {
      if (name === "si") current = "";
      else if (name === "rPh") phonetic++;
      else if (name === "t") inT = true;
    },
    text(value) {
      if (inT && phonetic === 0) current += value;
    },
    close(name) {
      if (name === "si") out.push(current);
      else if (name === "rPh") phonetic--;
      else if (name === "t") inT = false;
    },
  });
  return out;
}

interface Cell {
  col: number;
  text: boolean;
  value: string;
}

function readSheet(xml: string, shared: string[]): { rowNumber: number; cells: Cell[] }[] {
  const rows: { rowNumber: number; cells: Cell[] }[] = [];
  let row: { rowNumber: number; cells: Cell[] } | null = null;
  let cell: { col: number; type: string; v: string; inline: string } | null = null;
  let inV = false;
  let inT = false;
  let phonetic = 0;
  let lastRow = 0;
  scanXml(xml, {
    open(name, attrs) {
      if (name === "row") {
        const r = Number(attrs.r);
        lastRow = Number.isInteger(r) && r > 0 ? r : lastRow + 1;
        row = { rowNumber: lastRow, cells: [] };
      } else if (name === "c" && row) {
        const last = row.cells[row.cells.length - 1];
        cell = {
          col: attrs.r ? columnIndex(attrs.r) : last ? last.col + 1 : 0,
          type: attrs.t ?? "n",
          v: "",
          inline: "",
        };
      } else if (name === "v") inV = true;
      else if (name === "rPh") phonetic++;
      else if (name === "t") inT = true;
    },
    text(value) {
      if (!cell) return;
      if (inV) cell.v += value;
      else if (inT && phonetic === 0) cell.inline += value;
    },
    close(name) {
      if (name === "v") inV = false;
      else if (name === "rPh") phonetic--;
      else if (name === "t") inT = false;
      else if (name === "c" && cell && row) {
        const text = cell.type !== "n";
        const value =
          cell.type === "s"
            ? (shared[Number(cell.v)] ?? "")
            : cell.type === "inlineStr"
              ? cell.inline
              : cell.v;
        if (value !== "") row.cells.push({ col: cell.col, text, value });
        cell = null;
      } else if (name === "row" && row) {
        rows.push(row);
        row = null;
      }
    },
  });
  return rows;
}

export function parseXlsx(bytes: Uint8Array, opts: { maxPartBytes?: number } = {}): NumberedRow[] {
  const limit = opts.maxPartBytes ?? MAX_PART_BYTES;
  const first = inflate(bytes, [WORKBOOK, RELS], limit);
  if (!first[WORKBOOK]) throw new RejectFile(UNKNOWN);
  const book = readWorkbook(strFromU8(first[WORKBOOK]));
  if (book.date1904) throw new RejectFile("This Excel file uses the 1904 date system.");
  const path =
    book.itemsId !== null && first[RELS] ? targetFor(strFromU8(first[RELS]), book.itemsId) : null;
  if (path === null) throw new RejectFile("This Excel file has no Items sheet.");

  const second = inflate(bytes, [path, SHARED], limit);
  if (!second[path]) throw new RejectFile("This Excel file has no Items sheet.");
  const shared = second[SHARED] ? readSharedStrings(strFromU8(second[SHARED])) : [];
  const rows = readSheet(strFromU8(second[path]), shared).filter((r) => r.cells.length > 0);

  const [header, ...data] = rows;
  const headerOk =
    header !== undefined &&
    COLUMNS.every((name, i) => {
      const c = header.cells.find((x) => x.col === i);
      return c !== undefined && c.text && c.value === name;
    });
  if (!headerOk) throw new RejectFile("This Excel file's columns don't match an export.");

  return data.map((r) => {
    const at = (i: number) => r.cells.find((c) => c.col === i);
    const barcode = (i: number, label: string) => {
      const c = at(i);
      if (c && !c.text) {
        throw new RejectFile(
          `Row ${r.rowNumber}: ${label} is a number, so Excel may have changed it.`,
        );
      }
      return c?.value ?? "";
    };
    const patron = barcode(0, "Patron");
    const item = barcode(1, "Item");
    const when = at(2);
    if (when?.text) throw new RejectFile(`Row ${r.rowNumber}: Scanned at is not a date.`);
    const serial = when ? Number(when.value) : null;
    const scannedAt = serial === null ? null : fromExcelDate(serial);
    if (
      serial !== null &&
      (!Number.isFinite(serial) || serial < 0 || serial > MAX_SERIAL || !Number.isFinite(scannedAt))
    ) {
      throw new RejectFile(`Row ${r.rowNumber}: Scanned at is not a date.`);
    }
    return {
      patron,
      item,
      scannedAt,
      clerk: at(3)?.value ?? "",
      workstation: at(4)?.value ?? "",
      rowNumber: r.rowNumber,
    };
  });
}
