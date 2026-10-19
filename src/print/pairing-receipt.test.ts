import { describe, expect, it } from "vite-plus/test";
import { splitCode } from "../pairing/chunks";
import { codeFromBytes } from "../pairing/payload";
import { printErrorText } from "./pairing-receipt";

describe("printErrorText", () => {
  it("tells the clerk a code with too many barcodes cannot be printed", () => {
    let err: unknown;
    try {
      splitCode(codeFromBytes(new Uint8Array(200).fill(0x20)));
    } catch (e) {
      err = e;
    }
    expect(printErrorText(err)).toBe(
      "This code is too long to print. Use the camera or Copy instead.",
    );
  });

  it("reports any other failure as a print failure", () => {
    expect(printErrorText(new Error("print failed"))).toBe(
      "Could not print the code. Use the camera or Copy instead.",
    );
  });
});
