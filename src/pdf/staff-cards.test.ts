import { describe, expect, test } from "vite-plus/test";
import { code128Modules } from "../print/code128";
import { buildStaffCards, renderStaffCards } from "./render";
import { cardOrigin, fillRest, staffCardError, staffValue } from "./staff-cards";

const raw = (doc: { output(t: "arraybuffer"): ArrayBuffer }) =>
  new TextDecoder("latin1").decode(doc.output("arraybuffer"));
/** [text, x in points, y in points from the bottom] for every text draw. */
const placed = (s: string) =>
  [...s.matchAll(/([\d.]+) ([\d.]+) Td\s*\(((?:[^()\\]|\\.)*)\) Tj/g)].map(
    (m) => [m[3], Number(m[1]), Number(m[2])] as const,
  );

describe("staff cards", () => {
  test("cards run left to right, then top to bottom, on the Avery 5371 grid", () => {
    expect([0, 1, 2, 3, 9].map(cardOrigin)).toEqual([
      { x: 0.75, y: 0.5 },
      { x: 4.25, y: 0.5 },
      { x: 0.75, y: 2.5 },
      { x: 4.25, y: 2.5 },
      { x: 4.25, y: 8.5 },
    ]);
  });

  test("case is kept and only surrounding whitespace is trimmed", () => {
    expect(staffValue("  BDailey\t")).toBe("BDailey");
    expect(staffValue("b dailey")).toBe("b dailey");
    expect(code128Modules(staffValue("bdailey"))).not.toBe(code128Modules(staffValue("BDailey")));
  });

  test("errors: non-ASCII and too long; empty and punctuation are fine", () => {
    expect(staffCardError("")).toBeNull();
    expect(staffCardError("   ")).toBeNull();
    expect(staffCardError("b.dailey-2_x@lib")).toBeNull();
    expect(staffCardError("josé")).toBe('Can\'t go in a barcode: "é"');
    expect(staffCardError("a".repeat(16))).toBeNull();
    expect(staffCardError("a".repeat(17))).toBe("Too long to fit on the card");
  });

  test("fill the rest overwrites every later box and nothing before", () => {
    const one = fillRest(Array<string>(10).fill(""), 0);
    expect(one).toEqual(Array(10).fill(""));
    const a = fillRest(["bdailey", ...Array<string>(9).fill("")], 0);
    expect(a).toEqual(Array(10).fill("bdailey"));
    const b = fillRest([...a.slice(0, 5), "jdailey", ...a.slice(6)], 5);
    expect(b).toEqual([...Array(5).fill("bdailey"), ...Array(5).fill("jdailey")]);
  });

  test("pdf draws each name as typed, centred in its card, and skips empty cards", () => {
    const values = ["bdailey", "", "BDailey", ...Array<string>(7).fill("")];
    const t = placed(raw(buildStaffCards(values, false)));
    expect(t.map((p) => p[0])).toEqual(["bdailey", "BDailey"]);
    const [x0, y0] = [t[0]![1], t[0]![2]];
    const [x2, y2] = [t[1]![1], t[1]![2]];
    // Same column, one card (2" = 144 pt) lower; centred text starts left of the card centre.
    expect(x2).toBeCloseTo(x0, 1);
    expect(y0 - y2).toBeCloseTo(144, 1);
    expect(x0).toBeLessThan((0.75 + 1.75) * 72);
    expect(renderStaffCards(values).type).toBe("application/pdf");
  });
});
