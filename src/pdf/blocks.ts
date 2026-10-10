import type { SessionState } from "../log/types";

export interface Block {
  patron: string;
  items: string[];
  clerks: string[];
  firstAt: number;
}

/** One block per patron: non-voided visits merged, voided/duplicate items dropped, ordered by first scan. */
export function blocksFromState(s: SessionState): Block[] {
  const byPatron = new Map<string, Block & { clerkSet: Set<string> }>();
  for (const v of s.visits) {
    if (v.voided) continue;
    let b = byPatron.get(v.patron);
    if (!b) {
      b = { patron: v.patron, items: [], clerks: [], firstAt: v.at, clerkSet: new Set() };
      byPatron.set(v.patron, b);
    }
    b.firstAt = Math.min(b.firstAt, v.at);
    b.clerkSet.add(v.employee);
    for (const i of v.items) {
      if (i.voided) continue;
      b.clerkSet.add(i.employee);
      if (!b.items.includes(i.barcode)) b.items.push(i.barcode);
    }
  }
  return [...byPatron.values()]
    .map(({ clerkSet, ...b }) => ({ ...b, clerks: [...clerkSet].sort() }))
    .sort(
      (a, b) => a.firstAt - b.firstAt || (a.patron < b.patron ? -1 : a.patron > b.patron ? 1 : 0),
    );
}
