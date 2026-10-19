import { describe, expect, it } from "vite-plus/test";
import { splitCode } from "../pairing/chunks";
import { code128Modules, code128WidthMm, fitsReceipt, QUIET_MODULES } from "./code128";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_:";
const PRINTABLE_MM = 70;
const DOTS_PER_MODULE = 2;
const PRINTER_DOTS = 576;

function random(length: number, alphabet = ALPHABET): string {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function fits(text: string): void {
  const modules = code128Modules(text);
  expect(code128WidthMm(text), text).toBeLessThanOrEqual(PRINTABLE_MM);
  expect((modules.length + 2 * QUIET_MODULES) * DOTS_PER_MODULE, text).toBeLessThanOrEqual(
    PRINTER_DOTS,
  );
}

describe("code128", () => {
  it("fits any 20-char chunk on a 72 mm receipt at two dots per module", () => {
    for (let i = 0; i < 1000; i++) fits(random(20));
    for (let i = 0; i < 1000; i++) fits(random(20, "0123456789a"));
  });

  it("fits every chunk of random codes up to 560 chars", () => {
    for (let i = 0; i < 100; i++) {
      const code = "OC1:" + random(1 + Math.floor(Math.random() * 556), ALPHABET.slice(0, 64));
      for (const chunk of splitCode(code)) fits(chunk);
    }
  });

  it("draws start, data, check and stop patterns", () => {
    const modules = code128Modules("AB12");
    expect(modules).toMatch(/^(11010010000|11010011100)/);
    expect(modules).toMatch(/1100011101011$/);
    expect(modules).toMatch(/^[01]+$/);
  });

  it("is case-sensitive", () => {
    expect(code128Modules("ab")).not.toBe(code128Modules("AB"));
  });
});

describe("fitsReceipt", () => {
  it("accepts a 14-digit library barcode", () => {
    expect(fitsReceipt("31234000123456")).toBe(true);
  });

  it("rejects a 40-character alphanumeric code", () => {
    expect(fitsReceipt("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD")).toBe(false);
  });
});
