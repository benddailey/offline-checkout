import { describe, expect, it } from "vite-plus/test";
import {
  addScan,
  CHUNK_DIGITS,
  DATA_DIGITS,
  emptyCollector,
  isPairingText,
  MAX_CHUNKS,
  missing,
  parseChunk,
  progressText,
  setIdFor,
  splitCode,
  type AddResult,
  type Collector,
} from "./chunks";
import { codeFromBytes } from "./payload";

/** A code of `n` bytes; like a real one, its first byte is never 0. */
function code(n: number, seed = 0): string {
  const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + seed * 11 + 5) % 256);
  bytes[0] = 0x20;
  return codeFromBytes(bytes);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 5 + 3) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function collect(chunks: string[]): { last: AddResult; c: Collector } {
  let c = emptyCollector();
  let last: AddResult = { kind: "invalid" };
  for (const chunk of chunks) {
    last = addScan(c, chunk);
    if (last.kind === "added" || last.kind === "repeat") c = last.collector;
  }
  return { last, c };
}

describe("setIdFor", () => {
  it("is two digits", () => {
    for (let i = 0; i < 500; i++) expect(setIdFor(String(i * 7919))).toMatch(/^\d{2}$/);
  });

  it("gives a reprint of the same code the same barcodes", () => {
    expect(splitCode(code(110))).toEqual(splitCode(code(110)));
  });

  it("spreads codes over the set ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, (_, i) => setIdFor(`${i}123456789`)));
    expect(ids.size).toBeGreaterThan(90);
  });
});

describe("splitCode", () => {
  it("prints a real-sized 111-byte code as 8 all-digit barcodes of 40 digits", () => {
    const chunks = splitCode(code(111));
    expect(chunks).toHaveLength(8);
    for (const chunk of chunks) expect(chunk).toMatch(/^\d{40}$/);
    const sets = new Set(chunks.map((ch) => ch.slice(0, 2)));
    expect(sets.size).toBe(1);
  });

  it("numbers each barcode n of N", () => {
    const chunks = splitCode(code(111));
    chunks.forEach((chunk, i) => {
      expect(parseChunk(chunk)).toMatchObject({ index: i + 1, total: chunks.length });
    });
  });

  it(`fits ${MAX_CHUNKS} barcodes and refuses more`, () => {
    const bytesThatFit = Math.floor((MAX_CHUNKS * DATA_DIGITS) / Math.log10(256));
    expect(splitCode(code(bytesThatFit))).toHaveLength(MAX_CHUNKS);
    expect(() => splitCode(code(bytesThatFit + 2))).toThrow("too long");
  });

  it("refuses text that is not a current code", () => {
    expect(() => splitCode("OC1:abc")).toThrow();
    expect(() => splitCode("hello")).toThrow();
  });
});

describe("parseChunk", () => {
  it("reads set, index, total and data", () => {
    // Position 12 is index 3 of 5: 5*4/2 + 3 - 1.
    expect(parseChunk(`4212${"7".repeat(DATA_DIGITS)}`)).toEqual({
      set: "42",
      index: 3,
      total: 5,
      data: "7".repeat(DATA_DIGITS),
    });
  });

  it("rejects text that is not a chunk", () => {
    for (const text of [
      "",
      "31234567890123", // item barcode
      "1".repeat(CHUNK_DIGITS - 1),
      "1".repeat(CHUNK_DIGITS + 1),
      `4299${"0".repeat(DATA_DIGITS)}`, // position past 13 of 13
      `42AB${"0".repeat(DATA_DIGITS)}`,
    ]) {
      expect(parseChunk(text), text).toBeNull();
    }
  });
});

describe("isPairingText", () => {
  it("knows whole codes of any version and printed barcodes", () => {
    expect(isPairingText(code(20))).toBe(true);
    expect(isPairingText(" OC1:abc ")).toBe(true);
    expect(isPairingText(splitCode(code(111))[0]!)).toBe(true);
  });

  it("leaves patron and item barcodes alone", () => {
    for (const text of ["31234567890123", "P1", "OC-END", "OC2", ""]) {
      expect(isPairingText(text), text).toBe(false);
    }
  });
});

describe("addScan", () => {
  const c111 = code(111);
  const chunks = splitCode(c111);

  it("rebuilds the code from barcodes in any order, ignoring repeats", () => {
    const order = shuffle(chunks);
    let c = emptyCollector();
    for (const [n, chunk] of order.entries()) {
      if (n === 3) {
        const again = addScan(c, order[0]!);
        expect(again.kind).toBe("repeat");
        if (again.kind === "repeat") expect(again.collector.parts.size).toBe(3);
      }
      const r = addScan(c, ` ${chunk} `);
      if (n < order.length - 1) {
        expect(r.kind).toBe("added");
        if (r.kind === "added") c = r.collector;
      } else {
        expect(r).toEqual({ kind: "complete", code: c111 });
      }
    }
  });

  it("round-trips codes of every length", () => {
    for (let n = 1; n <= 190; n++) {
      const c = code(n, n);
      expect(collect(splitCode(c)).last, String(n)).toEqual({ kind: "complete", code: c });
    }
  });

  it("never mutates the collector it is given", () => {
    const c = emptyCollector();
    addScan(c, chunks[0]!);
    expect(c).toEqual(emptyCollector());
  });

  it("rejects a barcode from another printed code and keeps the progress", () => {
    const { c } = collect([chunks[0]!]);
    let seed = 1;
    let other = splitCode(code(111, seed));
    while (other[0]!.slice(0, 2) === chunks[0]!.slice(0, 2)) other = splitCode(code(111, ++seed));
    expect(addScan(c, other[1]!)).toEqual({ kind: "other-set" });
    expect(c.parts.size).toBe(1);
  });

  it("catches two receipts whose set ids collide once all pieces are in", () => {
    const set = chunks[0]!.slice(0, 2);
    let seed = 1;
    let other = splitCode(code(111, seed));
    while (other[0]!.slice(0, 2) !== set) other = splitCode(code(111, ++seed));
    expect(collect([other[0]!, ...chunks.slice(1)]).last).toEqual({ kind: "other-set" });
  });

  it("rejects a barcode of the same set with a different total", () => {
    const { c } = collect([chunks[0]!]);
    const odd = chunks[0]!.slice(0, 2) + "00" + "0".repeat(DATA_DIGITS);
    expect(addScan(c, odd).kind).toBe("invalid");
  });

  it("passes a whole code of any version through", () => {
    expect(addScan(emptyCollector(), "  OC2:abc ")).toEqual({ kind: "full", code: "OC2:abc" });
    expect(addScan(emptyCollector(), "OC1:abc")).toEqual({ kind: "full", code: "OC1:abc" });
  });

  it("rejects item barcodes and blank text", () => {
    for (const text of ["31234567890123", "", "  "]) {
      expect(addScan(emptyCollector(), text).kind).toBe("invalid");
    }
  });
});

describe("progress", () => {
  const twelve = splitCode(code(170));

  it("lists the missing pieces", () => {
    expect(twelve).toHaveLength(12);
    const { c } = collect(twelve.filter((_, i) => i !== 2 && i !== 8));
    expect(missing(c)).toEqual([3, 9]);
    expect(progressText(c)).toBe("Received 10 of 12 — missing 3, 9");
  });

  it("says only the count once all are in", () => {
    const c: Collector = {
      set: "42",
      total: 12,
      parts: new Map(twelve.map((ch, i) => [i + 1, ch.slice(4)])),
    };
    expect(progressText(c)).toBe("Received 12 of 12");
  });
});
