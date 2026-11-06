import { recordId } from "../log/ids";
import { clampName } from "../log/limits";
import { reduce } from "../log/reduce";
import type { ImportedBody, LogRecord } from "../log/types";
import type { FileSource, ImportRow } from "./rows";
import type { SessionSource } from "./session";

export type ImportSource = SessionSource | FileSource;

export const IMPORTED_CLERK = "Imported";

export interface SourcePlan {
  source: ImportSource;
  /** New records from this source; empty when it changes nothing. */
  records: LogRecord[];
  adds: { patrons: number; items: number };
  alreadyHere: number;
  voidedHere: number;
  /** Live here before, voided by this source's records. */
  voidedBySource: number;
  range: { from: number; to: number } | null;
  changed: boolean;
}

export interface ImportPlan {
  sources: SourcePlan[];
  records: LogRecord[];
  audits: ImportedBody[];
  /** Barcodes on more than one patron after this import and not before it. */
  alsoOnOtherPatron: number;
  anythingNew: boolean;
}

interface PlanOptions {
  sessionId: string;
  newDeviceId: () => string;
  now: number;
}

const pairKey = (patron: string, item: string) => JSON.stringify([patron, item]);

interface Contents {
  livePairs: Set<string>;
  voidedPairs: Set<string>;
  livePatrons: Set<string>;
  /** Including patrons whose visits are all voided. */
  patrons: Set<string>;
  /** Barcodes live on more than one patron. */
  shared: Set<string>;
}

function contentsOf(records: LogRecord[]): Contents {
  const c: Contents = {
    livePairs: new Set(),
    voidedPairs: new Set(),
    livePatrons: new Set(),
    patrons: new Set(),
    shared: new Set(),
  };
  const patronOf = new Map<string, string>();
  for (const v of reduce(records).visits) {
    c.patrons.add(v.patron);
    if (!v.voided) c.livePatrons.add(v.patron);
    for (const i of v.items) {
      if (i.voided) {
        c.voidedPairs.add(pairKey(v.patron, i.barcode));
        continue;
      }
      c.livePairs.add(pairKey(v.patron, i.barcode));
      const first = patronOf.get(i.barcode);
      if (first === undefined) patronOf.set(i.barcode, v.patron);
      else if (first !== v.patron) c.shared.add(i.barcode);
    }
  }
  return c;
}

function countMissing(from: Set<string>, other: Set<string>): number {
  let n = 0;
  for (const k of from) if (!other.has(k)) n++;
  return n;
}

function hasClerk(row: ImportRow): boolean {
  const clerk = row.clerk.trim();
  return clerk !== "" && clerk !== IMPORTED_CLERK;
}

function beats(a: ImportRow, b: ImportRow): boolean {
  if (hasClerk(a) !== hasClerk(b)) return hasClerk(a);
  return (a.scannedAt ?? Infinity) < (b.scannedAt ?? Infinity);
}

function pickWinners(sources: ImportSource[]) {
  const winners = new Map<string, ImportRow>();
  const patronsWithItems = new Set<string>();
  for (const source of sources) {
    if (source.kind !== "file") continue;
    for (const row of source.rows) {
      if (row.item !== "") patronsWithItems.add(row.patron);
      const key = pairKey(row.patron, row.item);
      const current = winners.get(key);
      if (!current || beats(row, current)) winners.set(key, row);
    }
  }
  return { winners, patronsWithItems };
}

function rangeOf(times: Iterable<number>): SourcePlan["range"] {
  let range: SourcePlan["range"] = null;
  for (const t of times) {
    if (!range) range = { from: t, to: t };
    else if (t < range.from) range.from = t;
    else if (t > range.to) range.to = t;
  }
  return range;
}

function itemTimes(source: ImportSource): number[] {
  if (source.kind === "session") {
    return source.records.flatMap((r) => (r.type === "item-scanned" ? [r.at] : []));
  }
  return source.rows.flatMap((r) => (r.item !== "" && r.scannedAt !== null ? [r.scannedAt] : []));
}

type Counted = Pick<SourcePlan, "records" | "alreadyHere" | "voidedHere">;

function planSession(source: SessionSource, stored: LogRecord[], here: Contents): Counted {
  const seen = new Set(stored.map(recordId));
  const fresh = source.records.filter((r) => !seen.has(recordId(r)));
  let alreadyHere = 0;
  for (const pair of contentsOf(source.records).livePairs)
    if (here.livePairs.has(pair)) alreadyHere++;
  return {
    // Gaps alone wait for the next real change, which picks them up and keeps seq contiguous.
    records: fresh.some((r) => r.type !== "import-gap") ? fresh : [],
    alreadyHere,
    voidedHere: 0,
  };
}

function planFile(
  source: FileSource,
  batch: ReturnType<typeof pickWinners>,
  here: Contents,
  o: PlanOptions,
): Counted {
  const earliest =
    rangeOf(source.rows.flatMap((r) => (r.scannedAt !== null ? [r.scannedAt] : [])))?.from ?? o.now;
  const visits = new Map<string, { row: ImportRow; at: number }[]>();
  let alreadyHere = 0;
  let voidedHere = 0;
  for (const row of source.rows) {
    const key = pairKey(row.patron, row.item);
    if (row.item === "") {
      if (batch.patronsWithItems.has(row.patron) || here.patrons.has(row.patron)) continue;
    } else if (here.livePairs.has(key)) {
      alreadyHere++;
      continue;
    } else if (here.voidedPairs.has(key)) {
      voidedHere++;
      continue;
    }
    if (batch.winners.get(key) !== row) {
      if (row.item !== "") alreadyHere++;
      continue;
    }
    const rows = visits.get(row.patron) ?? [];
    rows.push({ row, at: row.item === "" ? earliest : (row.scannedAt ?? earliest) });
    visits.set(row.patron, rows);
  }
  if (visits.size === 0) return { records: [], alreadyHere, voidedHere };

  const deviceId = o.newDeviceId();
  let seq = 0;
  const envelope = ({ row, at }: { row: ImportRow; at: number }) => {
    const workstation = clampName(row.workstation);
    return {
      sessionId: o.sessionId,
      deviceId,
      seq: ++seq,
      employee: clampName(row.clerk) || IMPORTED_CLERK,
      ...(workstation !== "" && { workstation }),
      at,
      imported: true as const,
    };
  };
  const records: LogRecord[] = [];
  for (const [patron, rows] of visits) {
    const first = rows.reduce((a, b) => (b.at < a.at ? b : a));
    const last = rows.reduce((a, b) => (b.at > a.at ? b : a));
    const started: LogRecord = { ...envelope(first), type: "patron-started", patron };
    const visitId = recordId(started);
    records.push(started);
    for (const r of rows) {
      if (r.row.item === "") continue;
      records.push({ ...envelope(r), type: "item-scanned", visitId, item: r.row.item });
    }
    records.push({ ...envelope(last), type: "patron-ended", visitId });
  }
  return { records, alreadyHere, voidedHere };
}

export function planImport(
  sources: ImportSource[],
  existing: LogRecord[],
  o: PlanOptions,
): ImportPlan {
  const batch = pickWinners(sources);
  const start = contentsOf(existing);
  let stored = existing;
  let here = start;
  const plans: SourcePlan[] = [];
  for (const source of sources) {
    const counted =
      source.kind === "session"
        ? planSession(source, stored, here)
        : planFile(source, batch, here, o);
    const changed = counted.records.length > 0;
    if (changed) stored = [...stored, ...counted.records];
    const after = changed ? contentsOf(stored) : here;
    plans.push({
      source,
      ...counted,
      adds: {
        patrons: countMissing(after.livePatrons, here.livePatrons),
        items: countMissing(after.livePairs, here.livePairs),
      },
      voidedBySource: countMissing(here.livePairs, after.livePairs),
      range: rangeOf(itemTimes(source)),
      changed,
    });
    here = after;
  }
  const changedPlans = plans.filter((p) => p.changed);
  return {
    sources: plans,
    records: changedPlans.flatMap((p) => p.records),
    audits: changedPlans.map((p) => ({
      type: "imported",
      source: p.source.kind,
      name: clampName(p.source.name),
      patrons: p.adds.patrons,
      items: p.adds.items,
    })),
    alsoOnOtherPatron: countMissing(here.shared, start.shared),
    anythingNew: changedPlans.length > 0,
  };
}
