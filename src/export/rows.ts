import { blocksFromState } from "../pdf/blocks";
import type { ItemState, SessionState } from "../log/types";

export interface ExportRow {
  patron: string;
  /** Empty for a patron whose items were all voided or who had none. */
  item: string;
  scannedAt: number | null;
  clerk: string;
  /** "" for a record from before workstation names. */
  workstation: string;
  session: string;
}

export const COLUMNS = ["Patron", "Item", "Scanned at", "Clerk", "Workstation", "Session"] as const;

/** One row per item, matching the PDF: same patrons, items and order. Duplicates keep their first scan. */
export function exportRows(s: SessionState): ExportRow[] {
  const session = s.name ?? "";
  const firstScan = new Map<string, ItemState>();
  const firstVisit = new Map<string, { clerk: string; workstation: string }>();
  for (const v of s.visits) {
    if (v.voided) continue;
    if (!firstVisit.has(v.patron)) {
      firstVisit.set(v.patron, { clerk: v.employee, workstation: v.workstation });
    }
    for (const i of v.items) {
      if (i.voided) continue;
      const key = `${v.patron}\n${i.barcode}`;
      const seen = firstScan.get(key);
      if (!seen || i.at < seen.at) firstScan.set(key, i);
    }
  }
  return blocksFromState(s).flatMap((b): ExportRow[] => {
    if (b.items.length === 0) {
      const { clerk, workstation } = firstVisit.get(b.patron) ?? { clerk: "", workstation: "" };
      return [{ patron: b.patron, item: "", scannedAt: null, clerk, workstation, session }];
    }
    return b.items.map((item) => {
      const i = firstScan.get(`${b.patron}\n${item}`)!;
      return {
        patron: b.patron,
        item,
        scannedAt: i.at,
        clerk: i.employee,
        workstation: i.workstation,
        session,
      };
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
