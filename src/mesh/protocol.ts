/**
 * Mesh wire protocol: JSON text over one ordered, reliable data channel labelled "oc".
 *
 * - hello:  sent by both sides when the channel opens (and again after setEmployee).
 *           A mismatched sessionId closes the link.
 * - intro:  the inviter tells its other peers about a newcomer; each one offers to it.
 * - signal: relayed offer/answer (full SDP, ICE gathering complete — no trickle).
 *           Forwarded one hop when `to` is not the receiver.
 * - app:    application payload, delivered to Mesh.onMessage.
 */

export const CHANNEL_LABEL = "oc";

export interface HelloMsg {
  t: "hello";
  sessionId: string;
  deviceId: string;
  employee: string;
}
export interface IntroMsg {
  t: "intro";
  deviceId: string;
  employee: string;
}
export interface SignalMsg {
  t: "signal";
  from: string;
  to: string;
  id: string;
  kind: "offer" | "answer";
  sdp: string;
}
export interface AppMsg {
  t: "app";
  body: unknown;
}

export type WireMsg = HelloMsg | IntroMsg | SignalMsg | AppMsg;

export function encodeWire(msg: WireMsg): string {
  return JSON.stringify(msg);
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Parse one frame; anything malformed or unknown yields null and is ignored by the caller. */
export function decodeWire(data: unknown): WireMsg | null {
  if (typeof data !== "string") return null;
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.t) {
    case "hello":
      return str(m.sessionId) && str(m.deviceId) && typeof m.employee === "string"
        ? { t: "hello", sessionId: m.sessionId, deviceId: m.deviceId, employee: m.employee }
        : null;
    case "intro":
      return str(m.deviceId) && typeof m.employee === "string"
        ? { t: "intro", deviceId: m.deviceId, employee: m.employee }
        : null;
    case "signal":
      return str(m.from) &&
        str(m.to) &&
        str(m.id) &&
        (m.kind === "offer" || m.kind === "answer") &&
        str(m.sdp)
        ? { t: "signal", from: m.from, to: m.to, id: m.id, kind: m.kind, sdp: m.sdp }
        : null;
    case "app":
      return { t: "app", body: m.body };
    default:
      return null;
  }
}
