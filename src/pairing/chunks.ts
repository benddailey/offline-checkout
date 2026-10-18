export const CHUNK_DATA = 16;
export const MAX_CHUNKS = 35;

export const OTHER_SET_MESSAGE =
  "That barcode is from a different printed code. Scan the barcodes from one receipt, or click Start over.";
export const INVALID_MESSAGE = "That barcode is not part of a pairing code.";

const PREFIX = "OC1:";
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHUNK = /^([A-Z0-9]{2})([1-9A-Z])([1-9A-Z])([A-Za-z0-9_:-]{1,16})$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** One printed barcode: `SSIT` + data (set id, base-36 index and total). */
export interface Chunk {
  set: string;
  index: number;
  total: number;
  data: string;
}

/** Set ids are two of [A-Z0-9], never both digits, so a numeric item or patron barcode is never a chunk. */
const SET_IDS = DIGITS.split("")
  .flatMap((a) => DIGITS.split("").map((b) => a + b))
  .filter((id) => /[A-Z]/.test(id));

/** Derived from the code (FNV-1a), so a reprint of the same code mixes with the first print. */
export function setIdFor(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 0x01000193);
  return SET_IDS[(h >>> 0) % SET_IDS.length]!;
}

export function splitCode(code: string, set: string = setIdFor(code)): string[] {
  const total = Math.ceil(code.length / CHUNK_DATA);
  if (total > MAX_CHUNKS) throw new Error("too long");
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const data = code.slice(i * CHUNK_DATA, (i + 1) * CHUNK_DATA);
    out.push(set + DIGITS[i + 1] + DIGITS[total] + data);
  }
  return out;
}

export function parseChunk(text: string): Chunk | null {
  const m = CHUNK.exec(text);
  if (!m) return null;
  const [, set, i, t, data] = m as unknown as [string, string, string, string, string];
  const index = DIGITS.indexOf(i);
  const total = DIGITS.indexOf(t);
  if (index > total || !/[A-Z]/.test(set)) return null;
  // Every piece but the last is full, and only the first holds the OC1: prefix.
  if (index < total && data.length !== CHUNK_DATA) return null;
  if (index === 1 ? !data.startsWith(PREFIX) : !BASE64URL.test(data)) return null;
  return { set, index, total, data };
}

export interface Collector {
  set: string | null;
  total: number;
  parts: Map<number, string>;
}

export const emptyCollector = (): Collector => ({ set: null, total: 0, parts: new Map() });

export type AddResult =
  | { kind: "full"; code: string }
  | { kind: "added" | "repeat"; collector: Collector }
  | { kind: "complete"; code: string }
  | { kind: "other-set" | "invalid" };

export function addScan(c: Collector, text: string): AddResult {
  const t = text.trim();
  if (t.startsWith(PREFIX)) return { kind: "full", code: t };
  const chunk = parseChunk(t);
  if (!chunk) return { kind: "invalid" };
  if (c.set !== null && chunk.set !== c.set) return { kind: "other-set" };
  if (c.set !== null && chunk.total !== c.total) return { kind: "invalid" };
  if (c.parts.has(chunk.index)) return { kind: "repeat", collector: c };
  const parts = new Map(c.parts).set(chunk.index, chunk.data);
  if (parts.size === chunk.total) {
    const code = Array.from({ length: chunk.total }, (_, i) => parts.get(i + 1)).join("");
    return { kind: "complete", code };
  }
  return { kind: "added", collector: { set: chunk.set, total: chunk.total, parts } };
}

export function missing(c: Collector): number[] {
  return Array.from({ length: c.total }, (_, i) => i + 1).filter((n) => !c.parts.has(n));
}

export function progressText(c: Collector): string {
  const gaps = missing(c);
  const head = `Received ${c.parts.size} of ${c.total}`;
  return gaps.length ? `${head} — missing ${gaps.join(", ")}` : head;
}
