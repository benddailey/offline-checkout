import type { LogRecord } from "./types";

const isStr = (v: unknown): v is string => typeof v === "string";

export function isLogRecord(x: unknown): x is LogRecord {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (
    !isStr(r.sessionId) ||
    !isStr(r.deviceId) ||
    !isStr(r.employee) ||
    typeof r.seq !== "number" ||
    !Number.isInteger(r.seq) ||
    r.seq <= 0 ||
    typeof r.at !== "number" ||
    !Number.isFinite(r.at)
  ) {
    return false;
  }
  switch (r.type) {
    case "session-created":
      return isStr(r.name);
    case "patron-started":
      return isStr(r.patron);
    case "item-scanned":
      return isStr(r.visitId) && isStr(r.item);
    case "patron-ended":
      return isStr(r.visitId);
    case "voided":
      return isStr(r.target);
    case "session-closed":
      return true;
    default:
      return false;
  }
}
