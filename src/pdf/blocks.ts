import type { ItemState, SessionState } from "../log/types";

export interface Block {
  patron: string;
  /**
   * One per distinct barcode, in the order the barcodes first appear in visit order. Each is the
   * barcode's earliest scan by `at`, which can come from a later visit on another workstation.
   */
  items: ItemState[];
  clerks: string[];
  firstAt: number;
  /** The patron's first non-voided visit. */
  firstVisit: { employee: string; workstation: string };
}

/** One block per patron: non-voided visits merged, voided/duplicate items dropped, ordered by first scan. */
export function blocksFromState(s: SessionState): Block[] {
  const byPatron = new Map<
    string,
    Block & { clerkSet: Set<string>; itemIndex: Map<string, number> }
  >();
  for (const v of s.visits) {
    if (v.voided) continue;
    let b = byPatron.get(v.patron);
    if (!b) {
      b = {
        patron: v.patron,
        items: [],
        clerks: [],
        firstAt: v.at,
        firstVisit: { employee: v.employee, workstation: v.workstation },
        clerkSet: new Set(),
        itemIndex: new Map(),
      };
      byPatron.set(v.patron, b);
    }
    b.firstAt = Math.min(b.firstAt, v.at);
    b.clerkSet.add(v.employee);
    for (const i of v.items) {
      if (i.voided) continue;
      b.clerkSet.add(i.employee);
      const at = b.itemIndex.get(i.barcode);
      if (at === undefined) {
        b.itemIndex.set(i.barcode, b.items.length);
        b.items.push(i);
      } else if (i.at < b.items[at].at) {
        b.items[at] = i;
      }
    }
  }
  return [...byPatron.values()]
    .map(({ patron, items, clerkSet, firstAt, firstVisit }) => ({
      patron,
      items,
      clerks: [...clerkSet].sort(),
      firstAt,
      firstVisit,
    }))
    .sort(
      (a, b) => a.firstAt - b.firstAt || (a.patron < b.patron ? -1 : a.patron > b.patron ? 1 : 0),
    );
}
