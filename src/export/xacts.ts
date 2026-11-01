import type { ExportRow } from "./rows";

/**
 * Evergreen's offline transaction file (pending.xacts): one JSON object per line, loaded with
 * Import Transactions on its Offline Circulation page. No due_date, so Evergreen applies the
 * library's loan rules from checkout_time.
 */
export function buildXacts(rows: ExportRow[]): string {
  let out = "";
  for (const r of rows) {
    if (!r.item || r.scannedAt === null) continue;
    const xact = {
      timestamp: Math.floor(r.scannedAt / 1000),
      type: "checkout",
      delta: 0,
      patron_barcode: r.patron,
      barcode: r.item,
      checkout_time: new Date(r.scannedAt).toISOString(),
    };
    out += `${JSON.stringify(xact)}\n`;
  }
  return out;
}
