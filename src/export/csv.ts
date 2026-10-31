import { COLUMNS, localDateTime, type ExportRow } from "./rows";

/** Stops Excel reading a cell as a formula; barcodes may legitimately start with - or +. */
function guard(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function field(v: string): string {
  const g = guard(v);
  return /[",\r\n]/.test(g) ? `"${g.replaceAll('"', '""')}"` : g;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel detects the encoding. */
export function buildCsv(rows: ExportRow[]): string {
  const lines = [COLUMNS.map(field).join(",")];
  for (const r of rows) {
    const time = r.scannedAt === null ? "" : localDateTime(r.scannedAt);
    lines.push([r.patron, r.item, time, r.clerk, r.session].map(field).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
