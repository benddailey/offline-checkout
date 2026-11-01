import { describe, expect, it } from "vite-plus/test";
import { buildIcns } from "./icns";

describe("buildIcns", () => {
  it("writes each PNG under every OSType for its size", () => {
    const small = Buffer.from("png-32");
    const big = Buffer.from("png-1024");
    const icns = buildIcns([
      { size: 32, png: small },
      { size: 1024, png: big },
    ]);
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);

    const found: [string, string][] = [];
    for (let at = 8; at < icns.length;) {
      const length = icns.readUInt32BE(at + 4);
      found.push([icns.toString("ascii", at, at + 4), icns.toString("ascii", at + 8, at + length)]);
      at += length;
    }
    expect(found).toEqual([
      ["icp5", "png-32"],
      ["ic11", "png-32"],
      ["ic10", "png-1024"],
    ]);
  });

  it("rejects a size .icns cannot hold", () => {
    expect(() => buildIcns([{ size: 48, png: Buffer.from("x") }])).toThrow(/48px/);
  });
});
