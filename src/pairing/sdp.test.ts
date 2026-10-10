import { test, expect, describe } from "vite-plus/test";
import { minifySdp, rebuildSdp } from "./sdp";

const files = import.meta.glob<string>("./fixtures/*.sdp", {
  query: "?raw",
  import: "default",
  eager: true,
});
const fixture = (name: string) => files[`./fixtures/${name}.sdp`]!;
const NAMES = ["offer-ip", "answer-ip", "offer-mdns", "answer-mdns"];

describe("minifySdp", () => {
  for (const name of NAMES) {
    test(`extracts the essentials from ${name}`, () => {
      const p = minifySdp(fixture(name));
      expect(p.ufrag.length).toBeGreaterThan(0);
      expect(p.pwd.length).toBeGreaterThan(0);
      expect(p.fingerprint).toHaveLength(95);
      expect(p.candidates.length).toBeGreaterThanOrEqual(1);
      for (const c of p.candidates) {
        expect(Number.isInteger(c.port)).toBe(true);
        if (name.endsWith("mdns")) expect(c.address.endsWith(".local")).toBe(true);
      }
    });
  }

  test("keeps only udp host candidates and deduplicates", () => {
    const sdp = [
      "a=ice-ufrag:u",
      "a=ice-pwd:p",
      `a=fingerprint:sha-256 ${Array(32).fill("AB").join(":")}`,
      "a=candidate:1 1 udp 2113937151 10.0.0.1 1000 typ host generation 0",
      "a=candidate:2 1 udp 2113937151 10.0.0.1 1000 typ host generation 0",
      "a=candidate:3 1 tcp 1518280447 10.0.0.1 9 typ host tcptype active",
      "a=candidate:4 1 udp 1677729535 1.2.3.4 2000 typ srflx raddr 0.0.0.0 rport 0",
      "",
    ].join("\r\n");
    expect(minifySdp(sdp).candidates).toEqual([{ address: "10.0.0.1", port: 1000 }]);
  });

  test("throws on SDP missing required fields", () => {
    expect(() => minifySdp("v=0\r\n")).toThrow();
  });
});

describe("rebuildSdp", () => {
  for (const name of NAMES) {
    for (const role of ["offer", "answer"] as const) {
      test(`${name} round-trips as ${role}`, () => {
        const parts = minifySdp(fixture(name));
        expect(minifySdp(rebuildSdp(parts, role))).toEqual(parts);
      });
    }
  }

  test("sets the DTLS role by SDP type", () => {
    const parts = minifySdp(fixture("offer-ip"));
    expect(rebuildSdp(parts, "offer")).toContain("a=setup:actpass");
    expect(rebuildSdp(parts, "answer")).toContain("a=setup:active");
  });
});
