import { blocksFromState } from "../pdf/blocks";
import type { ItemState, SessionState } from "../log/types";

export interface ExportRow {
  patron: string;
  /** Empty for a patron whose items were all voided or who had none. */
  item: string;
  scannedAt: number | null;
  clerk: string;
  session: string;
}

export const COLUMNS = ["Patron", "Item", "Scanned at", "Clerk", "Session"] as const;

/** One row per item, matching the PDF: same patrons, items and order. Duplicates keep their first scan. */
export function exportRows(s: SessionState): ExportRow[] {
  const session = s.name ?? "";
  const firstScan = new Map<string, ItemState>();
  const firstClerk = new Map<string, string>();
  for (const v of s.visits) {
    if (v.voided) continue;
    if (!firstClerk.has(v.patron)) firstClerk.set(v.patron, v.employee);
    for (const i of v.items) {
      if (i.voided) continue;
      const key = `${v.patron}\n${i.barcode}`;
      const seen = firstScan.get(key);
      if (!seen || i.at < seen.at) firstScan.set(key, i);
    }
  }
  return blocksFromState(s).flatMap((b): ExportRow[] => {
    if (b.items.length === 0) {
      const clerk = firstClerk.get(b.patron) ?? "";
      return [{ patron: b.patron, item: "", scannedAt: null, clerk, session }];
    }
    return b.items.map((item) => {
      const i = firstScan.get(`${b.patron}\n${item}`)!;
      return { patron: b.patron, item, scannedAt: i.at, clerk: i.employee, session };
    });
  });
}

/** Local time as YYYY-MM-DD HH:MM:SS. */
export function localDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}
