import { blocksFromState } from "../pdf/blocks";
import type { SessionState } from "../log/types";

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
  return blocksFromState(s).flatMap((b): ExportRow[] => {
    if (b.items.length === 0) {
      const { employee: clerk, workstation } = b.firstVisit;
      return [{ patron: b.patron, item: "", scannedAt: null, clerk, workstation, session }];
    }
    return b.items.map((i) => ({
      patron: b.patron,
      item: i.barcode,
      scannedAt: i.at,
      clerk: i.employee,
      workstation: i.workstation,
      session,
    }));
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
