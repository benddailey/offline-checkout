import { describe, expect, it } from "vite-plus/test";
import { RECEIPT_WIDTH_MM, pageHeightMm } from "./print";

describe("pageHeightMm", () => {
  it("keeps a short receipt taller than it is wide so Chrome prints it portrait", () => {
    expect(pageHeightMm(100)).toBe(RECEIPT_WIDTH_MM + 1);
  });

  it("sizes a tall receipt to its content plus the cutter feed", () => {
    expect(pageHeightMm(1000)).toBe(Math.ceil((1000 * 25.4) / 96) + 4);
  });

  it("is always taller than the page is wide", () => {
    for (const px of [0, 1, 100, 250, 262, 263, 400, 5000]) {
      expect(pageHeightMm(px)).toBeGreaterThan(RECEIPT_WIDTH_MM);
    }
  });
});
