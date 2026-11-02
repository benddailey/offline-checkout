import { describe, expect, test } from "vite-plus/test";
import { codeFromFile, pairingFileName, pairingFileText } from "./file";

const at = new Date(2026, 10, 1, 14, 5, 9).getTime();

describe("pairingFileName", () => {
  test("names the kind, session, workstation and time", () => {
    expect(pairingFileName("Join code", "Book Fair", "Front desk 2", at)).toBe(
      "offline-checkout-join-Book-Fair-Front-desk-2-2026-11-01-140509.txt",
    );
    expect(pairingFileName("Reply code", "Book Fair", "Back/office", at)).toBe(
      "offline-checkout-reply-Book-Fair-Back-office-2026-11-01-140509.txt",
    );
  });

  test("leaves out a missing workstation or session name", () => {
    expect(pairingFileName("Join code", "Book Fair", null, at)).toBe(
      "offline-checkout-join-Book-Fair-2026-11-01-140509.txt",
    );
    expect(pairingFileName("Reply code", undefined, "", at)).toBe(
      "offline-checkout-reply-2026-11-01-140509.txt",
    );
  });
});

describe("pairingFileText", () => {
  test("says it is temporary, when it expires, and puts the code on its own line", () => {
    const text = pairingFileText("Join code", "OC2:abc", at + 15 * 60_000);
    expect(text).toContain("Offline Checkout join code");
    expect(text).toContain("Temporary");
    expect(text).toContain("14:20");
    expect(text).toContain("Delete this file");
    expect(text.split("\r\n")).toContain("OC2:abc");
  });

  test("a reply code has no expiry time of its own", () => {
    expect(pairingFileText("Reply code", "OC2:abc")).not.toMatch(/\d\d:\d\d/);
  });
});

describe("codeFromFile", () => {
  test("finds the code in a saved file", () => {
    const text = pairingFileText("Join code", "OC2:AbC-_09", at);
    expect(codeFromFile(text)).toBe("OC2:AbC-_09");
  });

  test("takes a bare code, and an other-version code so its error can be shown", () => {
    expect(codeFromFile("  OC2:xyz\n")).toBe("OC2:xyz");
    expect(codeFromFile("OC1:old")).toBe("OC1:old");
  });

  test("returns null when there is no code", () => {
    expect(codeFromFile("shopping list\nmilk")).toBeNull();
    expect(codeFromFile("")).toBeNull();
  });
});
