import { test, expect, describe } from "vite-plus/test";
import { code39Modules, code39Width, NARROW_IN, QUIET_MODULES } from "./code39";

// Code 39 `*` start/stop: n w n n w n w n n (wide = 3) -> 1 0 1 1 1 ...
const STAR = "100010111011101";

describe("code39", () => {
  test("rejects text outside the Code 39 charset", () => {
    for (const t of ["", "abc", "A*B", "A\u00e9"]) expect(() => code39Modules(t)).toThrow();
  });
  test("single char: 3 characters of 16 modules plus 2 inter-character gaps", () => {
    const m = code39Modules("A");
    expect(m).toHaveLength(3 * 16 - 1);
    expect(m.startsWith(STAR)).toBe(true);
    expect(m.endsWith(STAR)).toBe(true);
  });
  test("every run is 1 or 3 modules (3:1 ratio)", () => {
    for (const t of ["A", "31204001234567", "AZ-. $/+%09", "OC-END"]) {
      const runs = code39Modules(t).match(/1+|0+/g)!;
      expect(runs.every((r) => r.length === 1 || r.length === 3)).toBe(true);
    }
  });
  test("no mod-43 check character", () => {
    expect(code39Modules("31204001234567")).toHaveLength(16 * 16 - 1);
  });
  test("width includes quiet zones", () => {
    expect(code39Width("31204001234567")).toBeCloseTo(2.0625, 3);
    expect(code39Width("A")).toBeCloseTo((47 + 2 * QUIET_MODULES) * NARROW_IN, 10);
  });
});
