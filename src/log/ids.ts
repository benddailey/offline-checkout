import type { Envelope, RecordId } from "./types";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function recordId(r: Pick<Envelope, "deviceId" | "seq">): RecordId {
  return `${r.deviceId}:${r.seq}`;
}
