import type { LogRecord, RecordBody } from "./types";

export function mk(deviceId: string, seq: number, body: RecordBody, at = seq * 1000): LogRecord {
  return { sessionId: "S", deviceId, seq, employee: deviceId.toUpperCase(), at, ...body };
}
