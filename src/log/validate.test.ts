import { describe, expect, it } from "vite-plus/test";
import type { LogRecord, RecordBody } from "./types";
import { isLogRecord } from "./validate";

const DEV = "dev0000001";
const SID = "ses0000001";

/** A record with real-looking ids (helpers.test-util's short ids are not valid on the wire). */
function rec(seq: number, body: RecordBody, deviceId = DEV): LogRecord {
  return { sessionId: SID, deviceId, seq, employee: "Ann", at: seq * 1000, ...body };
}

describe("isLogRecord", () => {
  it("accepts every valid record type", () => {
    for (const r of [
      rec(1, { type: "session-created", name: "n" }),
      rec(2, { type: "patron-started", patron: "P-1. $/+%" }),
      rec(3, { type: "item-scanned", visitId: `${DEV}:2`, item: "I" }),
      rec(4, { type: "patron-ended", visitId: `${DEV}:2` }),
      rec(5, { type: "voided", target: `${DEV}:3` }),
      rec(6, { type: "session-closed" }),
      rec(7, { type: "patron-started", patron: "X".repeat(64) }),
      { ...rec(8, { type: "session-created", name: "N".repeat(100) }), employee: "E".repeat(100) },
    ]) {
      expect(isLogRecord(r)).toBe(true);
    }
  });

  it("rejects non-objects and bad envelopes", () => {
    const ok = rec(1, { type: "session-closed" });
    for (const bad of [
      null,
      "x",
      1,
      [],
      { ...ok, sessionId: 1 },
      { ...ok, deviceId: 1 },
      { ...ok, employee: undefined },
      { ...ok, seq: 0 },
      { ...ok, seq: 1.5 },
      { ...ok, seq: "1" },
      { ...ok, at: NaN },
      { ...ok, at: "1" },
    ]) {
      expect(isLogRecord(bad)).toBe(false);
    }
  });

  it("rejects device and session ids that are not 10 lowercase letters or digits", () => {
    const ok = rec(1, { type: "session-closed" });
    for (const bad of [
      { ...ok, deviceId: "a" },
      { ...ok, deviceId: "DEV0000001" },
      { ...ok, deviceId: "dev-000001" },
      { ...ok, deviceId: "dev00000011" },
      { ...ok, sessionId: "S" },
      { ...ok, sessionId: "ses000000:" },
    ]) {
      expect(isLogRecord(bad)).toBe(false);
    }
  });

  it("rejects record ids in visitId or target that are not deviceId:seq", () => {
    for (const id of ["a:1", `${DEV}:0`, `${DEV}:01`, `${DEV}:x`, `${DEV}`, `${DEV}:1:2`, ""]) {
      expect(isLogRecord(rec(2, { type: "item-scanned", visitId: id, item: "I" }))).toBe(false);
      expect(isLogRecord(rec(2, { type: "patron-ended", visitId: id }))).toBe(false);
      expect(isLogRecord(rec(2, { type: "voided", target: id }))).toBe(false);
    }
  });

  it("rejects patron and item barcodes a Code 39 PDF could not print", () => {
    for (const code of ["", "p1", "P#1", "OC-END", "OC-VOIDLAST", "X".repeat(65)]) {
      expect(isLogRecord(rec(1, { type: "patron-started", patron: code }))).toBe(false);
      expect(isLogRecord(rec(2, { type: "item-scanned", visitId: `${DEV}:1`, item: code }))).toBe(
        false,
      );
    }
  });

  it("rejects over-long names", () => {
    expect(isLogRecord(rec(1, { type: "session-created", name: "N".repeat(101) }))).toBe(false);
    expect(isLogRecord({ ...rec(1, { type: "session-closed" }), employee: "E".repeat(101) })).toBe(
      false,
    );
  });

  it("rejects unknown types and missing or mistyped body fields", () => {
    const env = rec(1, { type: "session-closed" });
    const { type: _t, ...e } = env as unknown as Record<string, unknown>;
    for (const bad of [
      { ...e, type: "bogus" },
      { ...e },
      { ...e, type: "session-created" },
      { ...e, type: "patron-started", patron: 5 },
      { ...e, type: "item-scanned", visitId: `${DEV}:1` },
      { ...e, type: "item-scanned", item: "I" },
      { ...e, type: "patron-ended" },
      { ...e, type: "voided", target: null },
    ]) {
      expect(isLogRecord(bad)).toBe(false);
    }
  });
});
