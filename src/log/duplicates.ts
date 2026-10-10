import type { RecordId, SessionState } from "./types";

export type ItemCheck =
  | { kind: "ok" }
  | { kind: "dup-this-patron" }
  | { kind: "dup-other-patron"; patrons: string[] };

export function checkItem(state: SessionState, visitId: RecordId, item: string): ItemCheck {
  const current = state.visits.find((v) => v.id === visitId);
  const others = new Set<string>();
  for (const v of state.visits) {
    if (v.voided || !v.items.some((i) => !i.voided && i.barcode === item)) continue;
    if (v.id === visitId || (current && v.patron === current.patron)) {
      return { kind: "dup-this-patron" };
    }
    others.add(v.patron);
  }
  return others.size > 0
    ? { kind: "dup-other-patron", patrons: [...others].sort() }
    : { kind: "ok" };
}
