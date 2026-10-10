import type { SdpParts } from "./sdp";

export interface PairingPayload {
  kind: "offer" | "answer";
  sessionId: string;
  sessionName: string;
  deviceId: string;
  employee: string;
  sdp: SdpParts;
}

export type PairingErrorCode = "malformed" | "wrong-kind" | "wrong-session" | "expired";

export class PairingError extends Error {
  code: PairingErrorCode;
  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

const PREFIX = "OC1:";
const FP_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("bad base64url");
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function fingerprintToBase64(fp: string): string {
  const bytes = fp.split(":").map((h) => parseInt(h, 16));
  if (bytes.length !== FP_BYTES || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new PairingError("malformed", "Fingerprint must be 32 hex bytes");
  }
  return btoa(String.fromCharCode(...bytes));
}

function fingerprintFromBase64(b64: string): string {
  const bin = atob(b64);
  if (bin.length !== FP_BYTES) throw new Error("bad fingerprint length");
  return Array.from(bin, (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join(
    ":",
  );
}

/** "OC1:" + base64url(UTF-8 JSON array). Positional keys keep the QR small. */
export function encodePayload(p: PairingPayload): string {
  const arr = [
    p.kind === "offer" ? "o" : "a",
    p.sessionId,
    p.sessionName,
    p.deviceId,
    p.employee,
    p.sdp.ufrag,
    p.sdp.pwd,
    fingerprintToBase64(p.sdp.fingerprint),
    p.sdp.candidates.map((c) => [c.address, c.port]),
  ];
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(arr)));
}

const isStr = (v: unknown): v is string => typeof v === "string";

function parse(text: string): PairingPayload {
  const compact = text.replace(/\s+/g, "");
  if (!compact.startsWith(PREFIX)) throw new Error("missing OC1 prefix");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(
    fromBase64Url(compact.slice(PREFIX.length)),
  );
  const a: unknown = JSON.parse(json);
  if (!Array.isArray(a) || a.length !== 9) throw new Error("wrong arity");
  const [k, sessionId, sessionName, deviceId, employee, ufrag, pwd, fp, cands] = a as unknown[];
  if (k !== "o" && k !== "a") throw new Error("bad kind");
  if (![sessionId, sessionName, deviceId, employee, ufrag, pwd, fp].every(isStr)) {
    throw new Error("bad field type");
  }
  if (!ufrag || !pwd || !sessionId || !deviceId) throw new Error("empty field");
  if (!Array.isArray(cands) || cands.length === 0) throw new Error("no candidates");
  const candidates = cands.map((c: unknown) => {
    if (!Array.isArray(c) || c.length !== 2 || !isStr(c[0]) || !c[0])
      throw new Error("bad candidate");
    const port = c[1];
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("bad port");
    return { address: c[0], port: port as number };
  });
  return {
    kind: k === "o" ? "offer" : "answer",
    sessionId: sessionId as string,
    sessionName: sessionName as string,
    deviceId: deviceId as string,
    employee: employee as string,
    sdp: {
      ufrag: ufrag as string,
      pwd: pwd as string,
      fingerprint: fingerprintFromBase64(fp as string),
      candidates,
    },
  };
}

/** Decode scanned or pasted text. Every failure is a PairingError; kind mismatch is "wrong-kind". */
export function decodePayload(text: string, expect: "offer" | "answer"): PairingPayload {
  let p: PairingPayload;
  try {
    p = parse(text);
  } catch {
    throw new PairingError("malformed", "This is not a valid pairing code");
  }
  if (p.kind !== expect) {
    throw new PairingError("wrong-kind", `Expected a pairing ${expect} but got an ${p.kind}`);
  }
  return p;
}
