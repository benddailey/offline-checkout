import { test, expect, describe } from "vite-plus/test";
import {
  PairingError,
  codeBytes,
  codeFromBytes,
  decodePayload,
  encodePayload,
  type PairingPayload,
} from "./payload";

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
  test("a real offer packs into about 110 bytes", () => {
    const real: PairingPayload = {
      ...offer,
      sessionId: "k3j9x0ab12",
      sessionName: "Main desk Oct 19",
      deviceId: "0d8f2a1c9z",
      sdp: {
        ...sdp,
        pwd: "sKAMQ+ieSreDE9Cn3odmpYqU",
        candidates: [{ address: "3112f83b-3d3b-434d-af9f-4fdddbd7d110.local", port: 33384 }],
      },
    };
    const text = encodePayload(real);
    expect(text.startsWith("OC2:")).toBe(true);
    expect(codeBytes(text).length).toBeLessThanOrEqual(112);
    expect(decodePayload(text, "offer")).toEqual(real);
  });

  test("round-trips ids with leading zeros, and ids that are not randomId(10)", () => {
    for (const [sessionId, deviceId] of [
      ["0000000000", "zzzzzzzzzz"],
      ["00000abcde", "Device-1"],
      ["s", "abcdefghijk"],
    ]) {
      const p = { ...offer, sessionId: sessionId!, deviceId: deviceId! };
      expect(decodePayload(encodePayload(p), "offer")).toEqual(p);
    }
  });

  test("round-trips IPv4, mDNS, IPv6 and odd addresses", () => {
    const p: PairingPayload = {
      ...offer,
      sdp: {
        ...sdp,
        candidates: [
          { address: "0.0.0.0", port: 1 },
          { address: "255.255.255.255", port: 65535 },
          { address: "00000000-0000-0000-0000-000000000000.local", port: 2 },
          { address: "ABCDEF01-2345-6789-abcd-ef0123456789.local", port: 3 },
          { address: "fe80::1", port: 4 },
          { address: "010.1.1.1", port: 5 },
        ],
      },
    };
    expect(decodePayload(encodePayload(p), "offer")).toEqual(p);
  });

  test("round-trips ICE strings of any length in the ICE alphabet", () => {
    for (let n = 1; n <= 40; n++) {
      const ice = "aZ09+/".repeat(7).slice(0, n);
      const p = { ...offer, sdp: { ...sdp, ufrag: ice, pwd: ice } };
      expect(decodePayload(encodePayload(p), "offer"), String(n)).toEqual(p);
    }
  });

  test("a code from the previous version says so", () => {
    expect(code(() => decodePayload("OC1:WyJvIl0", "offer"))).toBe("old-version");
    expect(code(() => decodePayload("OC3:abc", "offer"))).toBe("old-version");
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
    const bytes = codeBytes(good);
    const withHead = (head: number) => codeFromBytes(Uint8Array.from([head, ...bytes.slice(1)]));
    const bad = [
      "hello",
      "",
      "OC2:",
      "OC2:abc",
      "OC2:!!!!",
      good.slice(0, good.length - 20),
      good + "AA",
      withHead(0x00),
      withHead(0x28),
      codeFromBytes(bytes.slice(0, -3)),
      encodePayload({ ...offer, sdp: { ...sdp, candidates: [] } }),
      encodePayload({ ...offer, sdp: { ...sdp, candidates: [{ address: "1.2.3.4", port: 0 }] } }),
      encodePayload({ ...offer, sdp: { ...sdp, candidates: [{ address: "", port: 1 }] } }),
      encodePayload({ ...offer, deviceId: "" }),
    ];
    for (const text of bad)
      expect(
        code(() => decodePayload(text, "offer")),
        text,
      ).toBe("malformed");
  });
});
