import { describe, expect, it } from "vite-plus/test";
import { buildIco } from "./ico";

describe("buildIco", () => {
  it("writes a directory entry per image pointing at its PNG data", () => {
    const a = Buffer.from("first-png");
    const b = Buffer.from("second");
    const ico = buildIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);

    const entry = (i: number) => ico.subarray(6 + 16 * i, 22 + 16 * i);
    expect(entry(0).readUInt8(0)).toBe(16);
    expect(entry(1).readUInt8(0)).toBe(0);
    expect(entry(1).readUInt8(1)).toBe(0);
    for (const [i, png] of [a, b].entries()) {
      const size = entry(i).readUInt32LE(8);
      const offset = entry(i).readUInt32LE(12);
      expect(ico.subarray(offset, offset + size)).toEqual(png);
    }
    expect(ico.length).toBe(6 + 32 + a.length + b.length);
  });
});
