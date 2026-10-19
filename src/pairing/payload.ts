import type { SdpParts } from "./sdp";

export interface PairingPayload {
  kind: "offer" | "answer";
  sessionId: string;
  sessionName: string;
  deviceId: string;
  employee: string;
  sdp: SdpParts;
}

export type PairingErrorCode =
  | "malformed"
  | "old-version"
  | "wrong-kind"
  | "wrong-session"
  | "expired";

export class PairingError extends Error {
  code: PairingErrorCode;
  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

export const PAIRING_PREFIX = "OC2:";
/** Any version's whole code, e.g. a v1 "OC1:" one from a workstation not yet updated. */
export const ANY_PAIRING_PREFIX = /^OC\d+:/;

/** First byte: 0x20 plus flags. Never 0, so the printed barcodes' decimal form keeps every byte. */
const VERSION = 0x20;
const ANSWER = 1;
const PACKED_SESSION = 2;
const PACKED_DEVICE = 4;

/** randomId(10) ids pack into 7 bytes; anything else is written as text. */
const PACKABLE_ID = /^[0-9a-z]{10}$/;
const ID_LEN = 10;
const ID_BYTES = 7;
/** RFC 8839 ice-char: ufrag and pwd pack at 6 bits a character. */
const ICE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const FP_BYTES = 32;
const IPV4_PART = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_PART}(\\.${IPV4_PART}){3}$`);
const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/;
const CAND_IPV4 = 0;
const CAND_MDNS = 1;
const CAND_TEXT = 2;

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("bad base64url");
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The bytes of a whole code, whitespace from copy/paste or QR wrapping ignored. Throws if not OC2. */
export function codeBytes(text: string): Uint8Array {
  const compact = text.replace(/\s+/g, "");
  if (!compact.startsWith(PAIRING_PREFIX)) throw new Error("missing OC2 prefix");
  return fromBase64Url(compact.slice(PAIRING_PREFIX.length));
}

export function codeFromBytes(bytes: Uint8Array): string {
  return PAIRING_PREFIX + toBase64Url(bytes);
}

class Writer {
  private out: number[] = [];
  byte(n: number): void {
    this.out.push(n & 0xff);
  }
  bytes(b: ArrayLike<number>): void {
    for (let i = 0; i < b.length; i++) this.byte(b[i]!);
  }
  varint(n: number): void {
    while (n >= 0x80) {
      this.byte((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.byte(n);
  }
  text(s: string): void {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    this.bytes(b);
  }
  id(s: string): void {
    let n = BigInt(parseInt(s.slice(0, 5), 36)) * 36n ** 5n + BigInt(parseInt(s.slice(5), 36));
    const b: number[] = [];
    for (let i = 0; i < ID_BYTES; i++, n >>= 8n) b.unshift(Number(n & 0xffn));
    this.bytes(b);
  }
  ice(s: string): void {
    this.varint(s.length);
    let acc = 0;
    let bits = 0;
    for (const c of s) {
      const v = ICE_CHARS.indexOf(c);
      if (v < 0) throw new Error(`not an ICE string: ${s}`);
      acc = (acc << 6) | v;
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        this.byte(acc >> bits);
      }
      acc &= (1 << bits) - 1;
    }
    if (bits > 0) this.byte(acc << (8 - bits));
  }
  port(n: number): void {
    this.byte(n >> 8);
    this.byte(n);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

class Reader {
  private at = 0;
  private b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  byte(): number {
    if (this.at >= this.b.length) throw new Error("truncated");
    return this.b[this.at++]!;
  }
  bytes(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error("truncated");
    return this.b.slice(this.at, (this.at += n));
  }
  varint(): number {
    let n = 0;
    for (let shift = 0; shift < 28; shift += 7) {
      const b = this.byte();
      n |= (b & 0x7f) << shift;
      if (b < 0x80) return n;
    }
    throw new Error("varint too long");
  }
  text(): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(this.varint()));
  }
  id(): string {
    let n = 0n;
    for (const b of this.bytes(ID_BYTES)) n = (n << 8n) | BigInt(b);
    const s = n.toString(36);
    if (s.length > ID_LEN) throw new Error("bad id");
    return s.padStart(ID_LEN, "0");
  }
  ice(): string {
    const len = this.varint();
    const b = this.bytes(Math.ceil((len * 6) / 8));
    let s = "";
    let acc = 0;
    let bits = 0;
    let i = 0;
    while (s.length < len) {
      if (bits < 6) {
        acc = (acc << 8) | b[i++]!;
        bits += 8;
      }
      bits -= 6;
      s += ICE_CHARS[(acc >> bits) & 63];
      acc &= (1 << bits) - 1;
    }
    return s;
  }
  port(): number {
    return (this.byte() << 8) | this.byte();
  }
  end(): void {
    if (this.at !== this.b.length) throw new Error("trailing bytes");
  }
}

function fingerprintBytes(fp: string): number[] {
  const bytes = fp.split(":").map((h) => parseInt(h, 16));
  if (bytes.length !== FP_BYTES || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new PairingError("malformed", "Fingerprint must be 32 hex bytes");
  }
  return bytes;
}

function fingerprintText(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(":");
}

/** "OC2:" + base64url of a packed binary record: about 110 bytes for a real offer. */
export function encodePayload(p: PairingPayload): string {
  const packSession = PACKABLE_ID.test(p.sessionId);
  const packDevice = PACKABLE_ID.test(p.deviceId);
  const w = new Writer();
  w.byte(
    VERSION |
      (p.kind === "answer" ? ANSWER : 0) |
      (packSession ? PACKED_SESSION : 0) |
      (packDevice ? PACKED_DEVICE : 0),
  );
  if (packSession) w.id(p.sessionId);
  else w.text(p.sessionId);
  w.text(p.sessionName);
  if (packDevice) w.id(p.deviceId);
  else w.text(p.deviceId);
  w.text(p.employee);
  w.ice(p.sdp.ufrag);
  w.ice(p.sdp.pwd);
  w.bytes(fingerprintBytes(p.sdp.fingerprint));
  w.varint(p.sdp.candidates.length);
  for (const { address, port } of p.sdp.candidates) {
    const mdns = MDNS.exec(address);
    if (IPV4.test(address)) {
      w.byte(CAND_IPV4);
      w.bytes(address.split(".").map(Number));
    } else if (mdns) {
      w.byte(CAND_MDNS);
      const hex = mdns.slice(1).join("");
      for (let i = 0; i < 32; i += 2) w.byte(parseInt(hex.slice(i, i + 2), 16));
    } else {
      w.byte(CAND_TEXT);
      w.text(address);
    }
    w.port(port);
  }
  return codeFromBytes(w.done());
}

function parse(text: string): PairingPayload {
  const r = new Reader(codeBytes(text));
  const head = r.byte();
  if ((head & ~7) !== VERSION) throw new Error("unknown version");
  const sessionId = head & PACKED_SESSION ? r.id() : r.text();
  const sessionName = r.text();
  const deviceId = head & PACKED_DEVICE ? r.id() : r.text();
  const employee = r.text();
  const ufrag = r.ice();
  const pwd = r.ice();
  const fingerprint = fingerprintText(r.bytes(FP_BYTES));
  const count = r.varint();
  const candidates: SdpParts["candidates"] = [];
  for (let i = 0; i < count; i++) {
    const tag = r.byte();
    let address: string;
    if (tag === CAND_IPV4) address = Array.from(r.bytes(4)).join(".");
    else if (tag === CAND_MDNS) {
      const h = Array.from(r.bytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
      address = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else if (tag === CAND_TEXT) address = r.text();
    else throw new Error("bad candidate");
    const port = r.port();
    if (!address || port < 1) throw new Error("bad candidate");
    candidates.push({ address, port });
  }
  r.end();
  if (!ufrag || !pwd || !sessionId || !deviceId) throw new Error("empty field");
  if (candidates.length === 0) throw new Error("no candidates");
  return {
    kind: head & ANSWER ? "answer" : "offer",
    sessionId,
    sessionName,
    deviceId,
    employee,
    sdp: { ufrag, pwd, fingerprint, candidates },
  };
}

/** Decode scanned or pasted text. Every failure is a PairingError; kind mismatch is "wrong-kind". */
export function decodePayload(text: string, expect: "offer" | "answer"): PairingPayload {
  const compact = text.replace(/\s+/g, "");
  if (ANY_PAIRING_PREFIX.test(compact) && !compact.startsWith(PAIRING_PREFIX)) {
    throw new PairingError(
      "old-version",
      "This code is from a different version of Offline Checkout",
    );
  }
  let p: PairingPayload;
  try {
    p = parse(compact);
  } catch {
    throw new PairingError("malformed", "This is not a valid pairing code");
  }
  if (p.kind !== expect) {
    throw new PairingError("wrong-kind", `Expected a pairing ${expect} but got an ${p.kind}`);
  }
  return p;
}
