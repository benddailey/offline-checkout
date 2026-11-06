import { COLUMNS } from "../export/rows";
import { RejectFile, type NumberedRow } from "./rows";

function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
      any = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
      any = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      out.push(row);
      row = [];
      cur = "";
      any = false;
    } else {
      cur += c;
      any = true;
    }
  }
  if (any || cur !== "" || row.length > 0) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

function strip(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}

export function isCsvHeader(text: string): boolean {
  const first = records(strip(text))[0];
  return !!first && first.length === COLUMNS.length && COLUMNS.every((c, i) => first[i] === c);
}

/** Undoes the ' that buildCsv's guard puts before a character Excel would read as a formula. */
function unguard(v: string): string {
  return v.replace(/^'(?=[=+\-@\t\r])/, "");
}

const TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function parseTime(v: string, rowNumber: number): number | null {
  if (v === "") return null;
  const changed = new RejectFile(
    `Row ${rowNumber}: the time was changed, probably by Excel saving this CSV, and barcodes may be damaged too. Use the original file, the Excel file or the Evergreen file.`,
  );
  const m = TIME.exec(v);
  if (!m) throw changed;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi ||
    check.getUTCSeconds() !== s
  ) {
    throw changed;
  }
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

export function parseCsv(text: string): NumberedRow[] {
  const recs = records(strip(text));
  const out: NumberedRow[] = [];
  for (let i = 1; i < recs.length; i++) {
    const r = recs[i];
    const rowNumber = i + 1;
    if (r.length === 1 && r[0] === "") continue;
    if (r.length !== COLUMNS.length) {
      throw new RejectFile(
        `Row ${rowNumber}: expected ${COLUMNS.length} columns, found ${r.length}.`,
      );
    }
    out.push({
      rowNumber,
      patron: unguard(r[0]),
      item: unguard(r[1]),
      scannedAt: parseTime(r[2], rowNumber),
      clerk: unguard(r[3]),
      workstation: unguard(r[4]),
    });
  }
  return out;
}
