import { test, expect, describe } from "vite-plus/test";
import { CONTROL, normalizeScan, validateBarcode } from "./barcode";

describe("barcode", () => {
  test("normalizeScan trims and uppercases", () => {
    expect(normalizeScan(" 31204abc \n")).toBe("31204ABC");
  });
  test("accepts digits and the full barcode charset", () => {
    expect(validateBarcode("31204001234567")).toEqual({ ok: true });
    expect(validateBarcode("A-1 . $/+%")).toEqual({ ok: true });
  });
  test("rejects bad characters and names them", () => {
    const r = validateBarcode("AB_1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('"_"');
  });
  test("rejects empty", () => {
    expect(validateBarcode("").ok).toBe(false);
  });
  test("rejects reserved control codes", () => {
    for (const code of [CONTROL.END, CONTROL.VOIDLAST]) {
      const r = validateBarcode(code);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("reserved");
    }
  });

  test("validateBarcode rejects more than 64 characters with a clear reason", () => {
    expect(validateBarcode("A".repeat(64))).toEqual({ ok: true });
    expect(validateBarcode("A".repeat(65))).toEqual({
      ok: false,
      reason: "Barcode is longer than 64 characters",
    });
  });
});
