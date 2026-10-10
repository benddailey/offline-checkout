import { test, expect, describe } from "vite-plus/test";
import { PairingError, decodePayload, encodePayload, type PairingPayload } from "./payload";

const FP32 = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 0)));
const sdp = {
  ufrag: "Ab12",
  pwd: "x".repeat(24),
  fingerprint: Array.from({ length: 32 }, (_, i) =>
    ((i * 7 + 3) % 256).toString(16).toUpperCase().padStart(2, "0"),
  ).join(":"),
  candidates: [{ address: "192.168.122.177", port: 46878 }],
};
const offer: PairingPayload = {
  kind: "offer",
  sessionId: "k3j9x0",
  sessionName: "Book Fair 1",
  deviceId: "d-8f2a1c",
  employee: "Ben",
  sdp,
};

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PairingError);
    return (e as PairingError).code;
  }
  return undefined;
}

describe("payload codec", () => {
  test("offer with a 10-char session name fits in 260 chars", () => {
    const text = encodePayload({ ...offer, sessionName: "0123456789" });
    expect(text.startsWith("OC1:")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(260);
  });

  test("round-trips", () => {
    expect(decodePayload(encodePayload(offer), "offer")).toEqual(offer);
  });

  test("round-trips arbitrary Unicode and separators in free text", () => {
    const p = { ...offer, sessionName: "Fête | 日本 : 🎉", employee: "Zoë:|O'Neil" };
    expect(decodePayload(encodePayload(p), "offer")).toEqual(p);
  });

  test("round-trips an answer with several candidates", () => {
    const p: PairingPayload = {
      ...offer,
      kind: "answer",
      sdp: {
        ...sdp,
        candidates: [
          { address: "10.0.0.2", port: 1 },
          { address: "abc.local", port: 65535 },
        ],
      },
    };
    expect(decodePayload(encodePayload(p), "answer")).toEqual(p);
  });

  test("ignores whitespace inserted by copy/paste or QR line wrapping", () => {
    const text = encodePayload(offer);
    const spaced = `${text.slice(0, 10)}\n  ${text.slice(10, 40)} \t${text.slice(40)}\r\n`;
    expect(decodePayload(spaced, "offer")).toEqual(offer);
  });

  test("wrong kind", () => {
    const text = encodePayload({ ...offer, kind: "answer" });
    expect(code(() => decodePayload(text, "offer"))).toBe("wrong-kind");
  });

  test("malformed input is always PairingError(malformed)", () => {
    const good = encodePayload(offer);
    const b64 = (v: unknown) =>
      `OC1:${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`;
    const bad = [
      "hello",
      "",
      "OC1:",
      "OC1:abc",
      "OC1:!!!!",
      good.slice(0, good.length - 20),
      good.replace("OC1:", "OC2:"),
      b64({}),
      b64(["o", "s", "n", "d", "e", "u", "p"]),
      b64(["o", "s", "n", "d", "e", "u", "p", "AAAA", [["1.2.3.4", 1]]]),
      b64(["o", "s", "n", "d", "e", "u", "p", FP32, []]),
      b64(["o", "s", "n", "d", "e", "u", "p", FP32, [["a", "1"]]]),
      b64(["x", "s", "n", "d", "e", "u", "p", FP32, [["a", 1]]]),
      b64([1, "s", "n", "d", "e", "u", "p", FP32, [["a", 1]]]),
    ];
    for (const text of bad)
      expect(
        code(() => decodePayload(text, "offer")),
        text,
      ).toBe("malformed");
  });
});
