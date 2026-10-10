import type { Envelope, VersionVector } from "./types";

export function vectorOf(records: Iterable<Pick<Envelope, "deviceId" | "seq">>): VersionVector {
  const seen = new Map<string, Set<number>>();
  for (const r of records) {
    let s = seen.get(r.deviceId);
    if (!s) seen.set(r.deviceId, (s = new Set()));
    s.add(r.seq);
  }
  const out: VersionVector = {};
  for (const [device, seqs] of seen) {
    let n = 0;
    while (seqs.has(n + 1)) n++;
    out[device] = n;
  }
  return out;
}

export function missingFor<T extends Envelope>(records: Iterable<T>, theirs: VersionVector): T[] {
  return [...records]
    .filter((r) => r.seq > (theirs[r.deviceId] ?? 0))
    .sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.seq - b.seq));
}
