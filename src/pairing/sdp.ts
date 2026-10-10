export interface SdpParts {
  ufrag: string;
  pwd: string;
  /** "AB:CD:…" sha-256, 32 colon-separated hex bytes */
  fingerprint: string;
  candidates: { address: string; port: number }[];
}

const CANDIDATE = /^a=candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ host(?:\s|$)/;

function attr(lines: string[], name: string): string | undefined {
  const prefix = `a=${name}:`;
  const line = lines.find((l) => l.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

/** Reduce a full SDP to the parts needed to rebuild it: ICE creds, DTLS fingerprint, udp host candidates. */
export function minifySdp(sdp: string): SdpParts {
  const lines = sdp.split(/\r?\n/);
  const ufrag = attr(lines, "ice-ufrag");
  const pwd = attr(lines, "ice-pwd");
  const fp = attr(lines, "fingerprint");
  if (!ufrag || !pwd || !fp) throw new Error("SDP is missing ice-ufrag, ice-pwd or fingerprint");
  const [algo, fingerprint] = fp.split(" ");
  if (algo !== "sha-256" || !fingerprint) throw new Error("SDP fingerprint is not sha-256");

  const seen = new Set<string>();
  const candidates: SdpParts["candidates"] = [];
  for (const line of lines) {
    const m = CANDIDATE.exec(line);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ address: m[1]!, port: Number(m[2]) });
  }
  return { ufrag, pwd, fingerprint: fingerprint.toUpperCase(), candidates };
}

/** Build a data-channel-only SDP from minified parts. */
export function rebuildSdp(p: SdpParts, role: "offer" | "answer"): string {
  const sessionId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
  const lines = [
    "v=0",
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...p.candidates.map(
      (c, i) => `a=candidate:${i + 1} 1 udp 2113937151 ${c.address} ${c.port} typ host`,
    ),
    `a=ice-ufrag:${p.ufrag}`,
    `a=ice-pwd:${p.pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${p.fingerprint}`,
    `a=setup:${role === "offer" ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ];
  return lines.join("\r\n");
}
