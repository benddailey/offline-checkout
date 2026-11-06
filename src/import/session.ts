import { reduce } from "../log/reduce";
import type { ExportState, LogRecord, RecordId } from "../log/types";

export interface SessionSource {
  kind: "session";
  name: string;
  /** Already rewritten for the target session. */
  records: LogRecord[];
  stillOpen: boolean;
  /** The source's latest Evergreen download, if any. */
  evergreen: ExportState | null;
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A device id that is valid, stable for this source session and device, and differs from the device's own id. */
export async function mergedDeviceId(sourceSessionId: string, deviceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${sourceSessionId}:${deviceId}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[hash[i]! % ALPHABET.length];
  return out;
}

export async function rewriteSession(
  records: LogRecord[],
  sourceSessionId: string,
  targetSessionId: string,
): Promise<LogRecord[]> {
  const ids = new Map<string, string>();
  const idFor = async (deviceId: string) => {
    let id = ids.get(deviceId);
    if (id === undefined) ids.set(deviceId, (id = await mergedDeviceId(sourceSessionId, deviceId)));
    return id;
  };
  const mapRecordId = async (id: RecordId): Promise<RecordId> => {
    const cut = id.lastIndexOf(":");
    return `${await idFor(id.slice(0, cut))}:${id.slice(cut + 1)}`;
  };

  const out: LogRecord[] = [];
  for (const r of records) {
    const env = {
      sessionId: targetSessionId,
      deviceId: await idFor(r.deviceId),
      seq: r.seq,
      employee: r.employee,
      ...(r.workstation !== undefined && { workstation: r.workstation }),
      at: r.at,
      imported: true as const,
    };
    switch (r.type) {
      case "patron-started":
        out.push({ ...env, type: r.type, patron: r.patron });
        break;
      case "item-scanned":
        out.push({ ...env, type: r.type, visitId: await mapRecordId(r.visitId), item: r.item });
        break;
      case "patron-ended":
        out.push({ ...env, type: r.type, visitId: await mapRecordId(r.visitId) });
        break;
      case "voided":
        out.push({ ...env, type: r.type, target: await mapRecordId(r.target) });
        break;
      default:
        out.push({ ...env, type: "import-gap" });
    }
  }
  return out;
}

export async function sessionSource(
  source: { sessionId: string; name: string },
  raw: LogRecord[],
  targetSessionId: string,
): Promise<SessionSource> {
  const state = reduce(raw);
  const evergreen = state.exports
    .filter((e) => e.kind === "xacts")
    .reduce<ExportState | null>((a, e) => (!a || e.at >= a.at ? e : a), null);
  return {
    kind: "session",
    name: source.name,
    records: await rewriteSession(raw, source.sessionId, targetSessionId),
    stillOpen: !state.closed,
    evergreen,
  };
}
