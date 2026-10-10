import { describe, expect, it } from "vite-plus/test";
import { mk } from "./helpers.test-util";
import { isLogRecord } from "./validate";

describe("isLogRecord", () => {
  it("accepts every valid record type", () => {
    for (const r of [
      mk("a", 1, { type: "session-created", name: "n" }),
      mk("a", 2, { type: "patron-started", patron: "P" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:2", item: "I" }),
      mk("a", 4, { type: "patron-ended", visitId: "a:2" }),
      mk("a", 5, { type: "voided", target: "a:3" }),
      mk("a", 6, { type: "session-closed" }),
    ]) {
      expect(isLogRecord(r)).toBe(true);
    }
  });

  it("rejects non-objects and bad envelopes", () => {
    const ok = mk("a", 1, { type: "session-closed" });
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

  it("rejects unknown types and missing or mistyped body fields", () => {
    const env = mk("a", 1, { type: "session-closed" });
    const { type: _t, ...e } = env as unknown as Record<string, unknown>;
    for (const bad of [
      { ...e, type: "bogus" },
      { ...e },
      { ...e, type: "session-created" },
      { ...e, type: "patron-started", patron: 5 },
      { ...e, type: "item-scanned", visitId: "a:1" },
      { ...e, type: "item-scanned", item: "I" },
      { ...e, type: "patron-ended" },
      { ...e, type: "voided", target: null },
    ]) {
      expect(isLogRecord(bad)).toBe(false);
    }
  });
});
