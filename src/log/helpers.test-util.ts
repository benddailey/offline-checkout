import type { LogRecord, RecordBody } from "./types";

/** A session id that passes isLogRecord (as randomId(10) makes). */
export const SID = "ses0000001";

/** A 10-character device id that passes isLogRecord, e.g. dev("a") === "aaaaaaaaaa". */
export const dev = (c: string): string => c.repeat(10);

export function mk(deviceId: string, seq: number, body: RecordBody, at = seq * 1000): LogRecord {
  return { sessionId: SID, deviceId, seq, employee: deviceId.toUpperCase(), at, ...body };
}
