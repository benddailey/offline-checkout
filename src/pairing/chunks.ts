import { ANY_PAIRING_PREFIX, codeBytes, codeFromBytes } from "./payload";

/** Digits in one printed barcode: the most Code 128 fits in 70 mm at two printer dots a module. */
export const CHUNK_DIGITS = 40;
const HEADER_DIGITS = 4;
export const DATA_DIGITS = CHUNK_DIGITS - HEADER_DIGITS;
/** Index and total share two digits as t(t-1)/2 + (i-1), which stays under 100 up to 13. */
export const MAX_CHUNKS = 13;

export const OTHER_SET_MESSAGE =
  "That barcode is from a different printed code. Scan the barcodes from one receipt, or click Start over.";
export const INVALID_MESSAGE = "That barcode is not part of a pairing code.";

const CHUNK = /^\d{40}$/;

/** One printed barcode: set id (2 digits), index and total (2 digits), then DATA_DIGITS of the code. */
export interface Chunk {
  set: string;
  index: number;
  total: number;
  data: string;
}

/** Derived from the data (FNV-1a), so a reprint mixes with the first print and a mixed set fails. */
export function setIdFor(digits: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < digits.length; i++) h = Math.imul(h ^ digits.charCodeAt(i), 0x01000193);
  return String((h >>> 0) % 100).padStart(2, "0");
}

const position = (index: number, total: number) => (total * (total - 1)) / 2 + index - 1;

function fromPosition(p: number): { index: number; total: number } | null {
  for (let total = 1; total <= MAX_CHUNKS; total++) {
    const base = position(1, total);
    if (p < base + total) return { index: p - base + 1, total };
  }
  return null;
}

function toDigits(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(10);
}

/** Leading zero bytes are lost, so codes never start with one (see payload VERSION). */
function fromDigits(digits: string): Uint8Array {
  const n = BigInt(digits);
  if (n === 0n) return new Uint8Array();
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
}

/** The code as one decimal number, left-padded with zeros across `n of N` all-digit barcodes. */
export function splitCode(code: string): string[] {
  const bytes = codeBytes(code);
  if (bytes[0] === 0) throw new Error("code starts with a zero byte");
  const raw = toDigits(bytes);
  const total = Math.max(1, Math.ceil(raw.length / DATA_DIGITS));
  if (total > MAX_CHUNKS) throw new Error("too long");
  const digits = raw.padStart(total * DATA_DIGITS, "0");
  const set = setIdFor(digits);
  return Array.from(
    { length: total },
    (_, i) =>
      set +
      String(position(i + 1, total)).padStart(2, "0") +
      digits.slice(i * DATA_DIGITS, (i + 1) * DATA_DIGITS),
  );
}

export function parseChunk(text: string): Chunk | null {
  if (!CHUNK.test(text)) return null;
  const at = fromPosition(Number(text.slice(2, HEADER_DIGITS)));
  if (!at) return null;
  return { set: text.slice(0, 2), ...at, data: text.slice(HEADER_DIGITS) };
}

/** A whole code (any version, so an old one gets its own error), or one printed barcode of one. */
export function isPairingText(text: string): boolean {
  const t = text.trim();
  return ANY_PAIRING_PREFIX.test(t) || parseChunk(t) !== null;
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
  if (ANY_PAIRING_PREFIX.test(t)) return { kind: "full", code: t };
  const chunk = parseChunk(t);
  if (!chunk) return { kind: "invalid" };
  if (c.set !== null && chunk.set !== c.set) return { kind: "other-set" };
  if (c.set !== null && chunk.total !== c.total) return { kind: "invalid" };
  if (c.parts.has(chunk.index)) return { kind: "repeat", collector: c };
  const parts = new Map(c.parts).set(chunk.index, chunk.data);
  if (parts.size === chunk.total) {
    const digits = Array.from({ length: chunk.total }, (_, i) => parts.get(i + 1)).join("");
    // Two receipts whose set ids collide (1 in 100) rebuild data that hashes to neither.
    if (setIdFor(digits) !== chunk.set) return { kind: "other-set" };
    return { kind: "complete", code: codeFromBytes(fromDigits(digits)) };
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
