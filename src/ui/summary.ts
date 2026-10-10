import type { RecordId, SessionState } from "../log/types";
import { blocksFromState } from "../pdf/blocks";

export interface SummaryItem {
  id: RecordId;
  barcode: string;
  /** The item, or the visit it was scanned on, was voided. */
  voided: boolean;
}

export interface SummaryPatron {
  patron: string;
  /** Every visit for this patron was voided: it is left out of the PDF. */
  voided: boolean;
  rows: SummaryItem[];
  /** Item count and clerks as printed on the PDF. */
  items: number;
  clerks: string[];
  /** Sort time: the PDF block's first scan, or the first visit for a fully voided patron. */
  at: number;
}

/**
 * One entry per patron in PDF order, listing every item scanned for them with voided ones kept
 * (struck through on screen). A live item scanned again on a later visit is listed once, as on
 * the PDF. Fully voided patrons are placed where their first visit was scanned.
 */
export function summaryPatrons(state: SessionState): SummaryPatron[] {
  const blocks = new Map(blocksFromState(state).map((b) => [b.patron, b]));
  const byPatron = new Map<string, SummaryPatron & { live: Set<string> }>();
  for (const v of state.visits) {
    let p = byPatron.get(v.patron);
    if (!p) {
      const block = blocks.get(v.patron);
      p = {
        patron: v.patron,
        voided: !block,
        rows: [],
        items: block?.items.length ?? 0,
        clerks: block?.clerks ?? [v.employee],
        at: block?.firstAt ?? v.at,
        live: new Set(),
      };
      byPatron.set(v.patron, p);
    }
    for (const i of v.items) {
      const voided = i.voided || v.voided;
      if (!voided) {
        if (p.live.has(i.barcode)) continue;
        p.live.add(i.barcode);
      }
      p.rows.push({ id: i.id, barcode: i.barcode, voided });
    }
  }
  return [...byPatron.values()]
    .map(({ live: _live, ...p }) => p)
    .sort((a, b) => a.at - b.at || (a.patron < b.patron ? -1 : a.patron > b.patron ? 1 : 0));
}
