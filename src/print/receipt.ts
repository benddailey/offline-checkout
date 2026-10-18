import type { RecordId, SessionState } from "../log/types";

export interface VisitReceipt {
  session: string;
  /** Local time the visit ended here, "YYYY-MM-DD HH:MM". */
  when: string;
  clerk: string;
  patron: string;
  /** Non-voided item barcodes, in visit order. */
  items: string[];
}

function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The receipt for one visit, or null if the visit is unknown or voided. */
export function visitReceipt(
  state: SessionState,
  visitId: RecordId,
  at: Date,
): VisitReceipt | null {
  const visit = state.visits.find((v) => v.id === visitId);
  if (!visit || visit.voided) return null;
  return {
    session: state.name ?? "Session",
    when: localStamp(at),
    clerk: visit.employee,
    patron: visit.patron,
    items: visit.items.filter((i) => !i.voided).map((i) => i.barcode),
  };
}

/** The printed text, one entry per line. */
export function receiptLines(r: VisitReceipt): string[] {
  return [
    "Offline Checkout",
    r.session,
    r.when,
    `Clerk: ${r.clerk}`,
    `Patron: ${r.patron}`,
    ...r.items,
    `Items: ${r.items.length}`,
  ];
}
