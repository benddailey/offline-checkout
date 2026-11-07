import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { CSV_FILE, drawShelf, HASH_FILE, PyRandom, pySum, SHELVES, shelvesHash } from "./shelves";

describe("shelves", () => {
  it("draws the same random numbers as Python's random.Random(11)", () => {
    const rng = new PyRandom(11);
    // python3 -c "import random; r=random.Random(11); print(r.random(), r.randrange(3),
    //   r.choice('abcdefghij'), r.uniform(.86, 1))"
    expect(rng.random()).toBe(0.4523795535098186);
    expect(rng.below(3)).toBe(2);
    expect(rng.choice("abcdefghij".split(""))).toBe("h");
    expect(rng.uniform(0.86, 1)).toBe(0.9232565248839392);
  });

  it("matches Python's compensated float sum", () => {
    expect(pySum(Array(10).fill(0.1))).toBe(1);
    expect(pySum([1e16, 1, -1e16])).toBe(1);
  });

  it("has committed backgrounds and hash that match the CSV", () => {
    expect(readFileSync(HASH_FILE, "utf8").trim()).toBe(shelvesHash());
    const csv = readFileSync(CSV_FILE, "utf8");
    for (const [id, palette] of Object.entries(SHELVES)) {
      const svg = readFileSync(resolve(CSV_FILE, "..", `${id}.svg`), "utf8");
      expect(drawShelf(csv, id, palette)).toBe(svg);
    }
  });

  it("draws one book per library", () => {
    const csv = readFileSync(CSV_FILE, "utf8");
    const svg = drawShelf(csv, "shelf-dark", SHELVES["shelf-dark"]);
    expect(svg.match(/<title>/g)).toHaveLength(csv.trim().split("\n").length - 1);
  });
});
