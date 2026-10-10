import { describe, expect, it } from "vite-plus/test";
import { candidateSummary } from "./checks";

const cand = (addr: string, type: string) =>
  `a=candidate:1 1 udp 2113937151 ${addr} 50000 typ ${type} generation 0`;

describe("candidateSummary", () => {
  it("reports mDNS host candidates", () => {
    expect(candidateSummary(cand("abc-123.local", "host"))).toBe("host (.local name)");
  });
  it("reports IP host candidates and other types", () => {
    const sdp = [cand("192.168.1.5", "host"), cand("1.2.3.4", "srflx")].join("\r\n");
    expect(candidateSummary(sdp)).toBe("host (IP address), srflx");
  });
  it("reports none", () => {
    expect(candidateSummary("v=0\r\na=ice-ufrag:x")).toBe("none gathered");
  });
});
