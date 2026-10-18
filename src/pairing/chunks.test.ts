import { describe, expect, it } from "vite-plus/test";
import {
  addScan,
  emptyCollector,
  MAX_CHUNKS,
  missing,
  newSetId,
  parseChunk,
  progressText,
  splitCode,
  type AddResult,
  type Collector,
} from "./chunks";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function code(length: number): string {
  let s = "OC1:";
  for (let i = 0; s.length < length; i++) s += B64[(i * 7 + 3) % B64.length];
  return s;
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

describe("newSetId", () => {
  it("is two upper-case letters or digits, at least one a letter", () => {
    for (let i = 0; i < 200; i++) expect(newSetId()).toMatch(/^(?=.*[A-Z])[A-Z0-9]{2}$/);
  });
});

describe("splitCode", () => {
  it("splits a 260-char code into 17 numbered chunks of at most 20 chars", () => {
    const c = code(260);
    const chunks = splitCode(c, "K7");
    expect(chunks).toHaveLength(17);
    const digits = "123456789ABCDEFGH";
    chunks.forEach((chunk, i) => {
      expect(chunk.length).toBeLessThanOrEqual(20);
      expect(chunk.slice(0, 4)).toBe(`K7${digits[i]}H`);
    });
    expect(chunks.map((ch) => ch.slice(4)).join("")).toBe(c);
  });

  it("uses one random set id for all chunks when none is given", () => {
    const sets = new Set(splitCode(code(100)).map((ch) => ch.slice(0, 2)));
    expect(sets.size).toBe(1);
  });

  it("fits 560 chars in 35 chunks and refuses 561", () => {
    expect(splitCode(code(560))).toHaveLength(MAX_CHUNKS);
    expect(() => splitCode(code(561))).toThrow("too long");
  });

  it("keeps case and - _ in the data", () => {
    const c = "OC1:aB-_zZ09xy";
    expect(parseChunk(splitCode(c, "Q1")[0]!)?.data).toBe(c);
  });
});

describe("parseChunk", () => {
  it("reads set, index, total and data", () => {
    expect(parseChunk("AB2Cabcdefghijklmnop")).toEqual({
      set: "AB",
      index: 2,
      total: 12,
      data: "abcdefghijklmnop",
    });
  });

  it("rejects text that is not a chunk", () => {
    for (const text of [
      "",
      "AB21abcdefghijklmnop", // index above total
      "ab2Cabcdefghijklmnop", // lower-case set
      "AB0Cabcdefghijklmnop", // index 0
      "AB2Cabcdefghijklmnopq", // 17 data chars
      "AB2Cabc", // short chunk that is not the last
      "AB1Cabcdefghijklmnop", // first chunk must start the code
      "31234567890123", // item barcode
      "31994567890123", // all-digit set id
    ]) {
      expect(parseChunk(text), text).toBeNull();
    }
  });
});

describe("addScan", () => {
  const c260 = code(260);
  const chunks = splitCode(c260, "K7");

  it("rebuilds the code from chunks in any order, ignoring repeats", () => {
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
        expect(r).toEqual({ kind: "complete", code: c260 });
      }
    }
  });

  it("never mutates the collector it is given", () => {
    const c = emptyCollector();
    addScan(c, chunks[0]!);
    expect(c).toEqual(emptyCollector());
  });

  it("rejects a chunk from another printed code and keeps the progress", () => {
    const { c } = collect([chunks[0]!]);
    const other = splitCode(c260, "Z9")[1]!;
    expect(addScan(c, other)).toEqual({ kind: "other-set" });
    expect(c.parts.size).toBe(1);
    expect(c.set).toBe("K7");
  });

  it("rejects a chunk of the same set with a different total", () => {
    const { c } = collect([chunks[0]!]);
    expect(addScan(c, "K72Aabcdefghijklmnop").kind).toBe("invalid");
  });

  it("passes a whole OC1 code through", () => {
    expect(addScan(emptyCollector(), "  OC1:abc ")).toEqual({ kind: "full", code: "OC1:abc" });
  });

  it("rejects item barcodes and blank text", () => {
    for (const text of ["31234567890123", "", "  "]) {
      expect(addScan(emptyCollector(), text).kind).toBe("invalid");
    }
  });

  it("completes a single-chunk code on its only chunk", () => {
    const [only] = splitCode("OC1:abc", "X1");
    expect(only).toBe("X111OC1:abc");
    expect(addScan(emptyCollector(), only!)).toEqual({ kind: "complete", code: "OC1:abc" });
  });
});

describe("progress", () => {
  const twelve = splitCode(code(12 * 16), "K7");

  it("lists the missing pieces", () => {
    const { c } = collect(twelve.filter((_, i) => i !== 2 && i !== 8));
    expect(missing(c)).toEqual([3, 9]);
    expect(progressText(c)).toBe("Received 10 of 12 — missing 3, 9");
  });

  it("says only the count once all are in", () => {
    const c: Collector = {
      set: "K7",
      total: 12,
      parts: new Map(twelve.map((ch, i) => [i + 1, ch.slice(4)])),
    };
    expect(progressText(c)).toBe("Received 12 of 12");
  });
});
