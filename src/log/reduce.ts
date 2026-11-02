import { recordId } from "./ids";
import type {
  ExportState,
  ItemState,
  LogRecord,
  RecordId,
  SessionState,
  VisitState,
} from "./types";

/** How a workstation is named in summaries: records from before names have none. */
export function workstationLabel(name: string): string {
  return name || "Not named";
}

/** Whether any record has a workstation name, so summaries need a By workstation list. */
export function hasWorkstations(s: SessionState): boolean {
  return Object.keys(s.perWorkstation).some((w) => w !== "");
}

function compare(a: LogRecord, b: LogRecord): number {
  return (
    a.at - b.at || (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0) || a.seq - b.seq
  );
}

/** Pure and deterministic: the result depends only on the set of records, never their order. */
export function reduce(records: Iterable<LogRecord>): SessionState {
  const byId = new Map<RecordId, LogRecord>();
  for (const r of records) byId.set(recordId(r), r);
  const sorted = [...byId.values()].sort(compare);

  const voidedTargets = new Set<RecordId>();
  const ended = new Set<RecordId>();
  let sessionId: string | null = null;
  let name: string | null = null;
  let closed = false;
  const visits = new Map<RecordId, VisitState>();
  const exports: ExportState[] = [];

  for (const r of sorted) {
    sessionId ??= r.sessionId;
    switch (r.type) {
      case "session-created":
        name ??= r.name;
        break;
      case "session-closed":
        closed = true;
        break;
      case "exported":
        exports.push({
          kind: r.kind,
          at: r.at,
          employee: r.employee,
          workstation: r.workstation ?? "",
        });
        break;
      case "voided":
        voidedTargets.add(r.target);
        break;
      case "patron-ended":
        ended.add(r.visitId);
        break;
      case "patron-started": {
        const id = recordId(r);
        visits.set(id, {
          id,
          patron: r.patron,
          deviceId: r.deviceId,
          employee: r.employee,
          workstation: r.workstation ?? "",
          at: r.at,
          ended: false,
          voided: false,
          items: [],
        });
        break;
      }
      case "item-scanned":
        break;
    }
  }

  for (const v of visits.values()) {
    v.ended = ended.has(v.id);
    v.voided = voidedTargets.has(v.id);
  }
  // Items whose visit has not arrived are simply not attached yet; a later reduce picks them up.
  for (const r of sorted) {
    if (r.type !== "item-scanned") continue;
    const visit = visits.get(r.visitId);
    if (!visit) continue;
    const id = recordId(r);
    const item: ItemState = {
      id,
      barcode: r.item,
      visitId: r.visitId,
      voided: visit.voided || voidedTargets.has(id),
      at: r.at,
      employee: r.employee,
      workstation: r.workstation ?? "",
    };
    visit.items.push(item);
  }

  const visitList = [...visits.values()]; // already in sorted order
  const livePatrons = new Set<string>();
  const perClerk: SessionState["perClerk"] = {};
  const clerk = (e: string) => (perClerk[e] ??= { patrons: 0, items: 0 });
  const perWorkstation: SessionState["perWorkstation"] = {};
  const desk = (w: string) => (perWorkstation[w] ??= { patrons: 0, items: 0 });
  // Counted as the PDF prints them: one block per patron, each item once per patron.
  const clerkPatrons = new Set<string>();
  const deskPatrons = new Set<string>();
  const patronItems = new Set<string>();
  const key = (...parts: string[]) => JSON.stringify(parts);
  for (const v of visitList) {
    if (v.voided) continue;
    livePatrons.add(v.patron);
    const cp = key(v.employee, v.patron);
    if (!clerkPatrons.has(cp)) {
      clerkPatrons.add(cp);
      clerk(v.employee).patrons++;
    }
    const dp = key(v.workstation, v.patron);
    if (!deskPatrons.has(dp)) {
      deskPatrons.add(dp);
      desk(v.workstation).patrons++;
    }
    for (const i of v.items) {
      if (i.voided) continue;
      patronItems.add(key(v.patron, i.barcode));
      clerk(i.employee).items++;
      desk(i.workstation).items++;
    }
  }
  // Clerks who only scanned items still appear via clerk(); ensure key order is stable.
  const byName = (m: SessionState["perClerk"]) => {
    const out: SessionState["perClerk"] = {};
    // "" (no workstation name) last, after the named ones.
    const keys = Object.keys(m).sort();
    if (keys[0] === "") keys.push(keys.shift()!);
    for (const k of keys) out[k] = m[k]!;
    return out;
  };

  return {
    sessionId,
    name,
    closed,
    visits: visitList,
    totals: { patrons: livePatrons.size, items: patronItems.size },
    perClerk: byName(perClerk),
    perWorkstation: byName(perWorkstation),
    exports,
  };
}
