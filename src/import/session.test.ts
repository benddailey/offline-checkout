import { describe, expect, it } from "vite-plus/test";
import { exportRows } from "../export/rows";
import { dev, mk, SID } from "../log/helpers.test-util";
import { reduce } from "../log/reduce";
import type { LogRecord } from "../log/types";
import { isLogRecord } from "../log/validate";
import { vectorOf } from "../log/vector";
import { mergedDeviceId, rewriteSession, sessionSource } from "./session";

const SRC = "ses0000002";
const TARGET = "ses0000003";
const a = dev("a");
const b = dev("b");

function source(): LogRecord[] {
  return [
    mk(a, 1, { type: "session-created", name: "Source" }),
    mk(a, 2, { type: "patron-started", patron: "P1" }),
    mk(a, 3, { type: "item-scanned", visitId: `${a}:2`, item: "I1" }),
    mk(a, 4, { type: "item-scanned", visitId: `${a}:2`, item: "I2" }),
    mk(a, 5, { type: "voided", target: `${a}:4` }),
    mk(a, 6, { type: "patron-ended", visitId: `${a}:2` }),
    mk(b, 1, { type: "patron-started", patron: "P2" }),
    mk(b, 2, { type: "item-scanned", visitId: `${b}:1`, item: "I3" }),
    mk(b, 3, { type: "voided", target: `${b}:1` }),
    mk(a, 7, { type: "exported", kind: "xacts" }),
    mk(a, 8, { type: "session-closed" }),
  ];
}

describe("mergedDeviceId", () => {
  it("gives a valid, stable id", async () => {
    const id = await mergedDeviceId("ses0000001", dev("a"));
    expect(id).toMatch(/^[0-9a-z]{10}$/);
    expect(await mergedDeviceId("ses0000001", dev("a"))).toBe(id);
    expect(await mergedDeviceId("ses0000002", dev("a"))).not.toBe(id);
  });
});

describe("rewriteSession", () => {
  it("can't collide with the same PC's records in the target", async () => {
    const out = await rewriteSession(source(), SRC, TARGET);
    const own = [mk(a, 2, { type: "patron-started", patron: "P9" })];
    const keys = new Set([...own, ...out].map((r) => `${r.deviceId}:${r.seq}`));
    expect(keys.size).toBe(out.length + own.length);
    expect(out.some((r) => r.deviceId === a)).toBe(false);
  });

  it("keeps voids attached", async () => {
    const out = await rewriteSession(source(), SRC, TARGET);
    const s = reduce(out);
    const p1 = s.visits.find((v) => v.patron === "P1")!;
    expect(p1.voided).toBe(false);
    expect(p1.items.map((i) => [i.barcode, i.voided])).toEqual([
      ["I1", false],
      ["I2", true],
    ]);
    const p2 = s.visits.find((v) => v.patron === "P2")!;
    expect(p2.voided).toBe(true);
    expect(p2.items.every((i) => i.voided)).toBe(true);
    expect(p1.ended).toBe(true);
  });

  it("keeps seq, at, employee and workstation, and sets imported", async () => {
    const raw = source().map((r) => (r.deviceId === b ? { ...r, workstation: "Desk 2" } : r));
    const out = await rewriteSession(raw, SRC, TARGET);
    expect(out).toHaveLength(raw.length);
    raw.forEach((r, i) => {
      const o = out[i]!;
      expect(o.sessionId).toBe(TARGET);
      expect(o.seq).toBe(r.seq);
      expect(o.at).toBe(r.at);
      expect(o.employee).toBe(r.employee);
      expect(o.workstation).toBe(r.workstation);
      expect(o.imported).toBe(true);
    });
    expect("workstation" in out[0]!).toBe(false);
  });

  it("doesn't close or rename the target", async () => {
    const out = await rewriteSession(source(), SRC, TARGET);
    for (const i of [0, 9, 10]) expect(out[i]!.type).toBe("import-gap");
    const imported = mk(a, 1, {
      type: "imported",
      source: "file",
      name: "f",
      patrons: 0,
      items: 0,
    });
    const again = await rewriteSession([imported], SRC, TARGET);
    expect(again[0]!.type).toBe("import-gap");
    const target = {
      ...mk(dev("t"), 1, { type: "session-created", name: "Target" }),
      sessionId: TARGET,
    };
    const s = reduce([target, ...out, ...again]);
    expect(s.closed).toBe(false);
    expect(s.name).toBe("Target");
    expect(s.exports).toEqual([]);
    expect(s.imports).toEqual([]);
  });

  it("keeps a gap for every replaced record", async () => {
    const raw = source();
    const out = await rewriteSession(raw, SRC, TARGET);
    const merged = await mergedDeviceId(SRC, a);
    expect(vectorOf(out)[merged]).toBe(raw.filter((r) => r.deviceId === a).length);
  });

  it("drops replaced records' body fields", async () => {
    const out = await rewriteSession(source(), SRC, TARGET);
    const gap = out[0]!;
    expect(gap.type).toBe("import-gap");
    expect(Object.keys(gap).sort()).toEqual(
      ["at", "deviceId", "employee", "imported", "seq", "sessionId", "type"].sort(),
    );
  });

  it("passes isLogRecord for every record", async () => {
    const imported = mk(b, 4, {
      type: "imported",
      source: "session",
      name: "x",
      patrons: 1,
      items: 2,
    });
    const out = await rewriteSession([...source(), imported], SRC, TARGET);
    expect(out.every(isLogRecord)).toBe(true);
  });

  it("rewrites a session that already holds imports", async () => {
    const first = await rewriteSession(source(), SRC, TARGET);
    const m = dev("m");
    const mid = [
      mk(m, 1, { type: "patron-started", patron: "P9" }),
      mk(m, 2, { type: "item-scanned", visitId: `${m}:1`, item: "O1" }),
      ...first,
    ].map((r) => ({ ...r, sessionId: TARGET }));
    const out = await rewriteSession(mid, TARGET, "ses0000004");
    expect(out.every(isLogRecord)).toBe(true);
    const oldIds = new Set(mid.map((r) => r.deviceId));
    expect(out.some((r) => oldIds.has(r.deviceId))).toBe(false);
    expect(out.every((r) => r.imported === true)).toBe(true);
    const s = reduce(out);
    const p1 = s.visits.find((v) => v.patron === "P1")!;
    expect(p1.imported).toBe(true);
    expect(p1.items.map((i) => i.voided)).toEqual([false, true]);
    expect(s.visits.find((v) => v.patron === "P2")!.voided).toBe(true);
    const rows = exportRows(s);
    expect(rows.filter((r) => r.item === "I1")).toHaveLength(1);
    expect(rows.filter((r) => r.item === "O1")).toHaveLength(1);
    expect(rows.filter((r) => r.item === "I2")).toHaveLength(0);
  });
});

describe("sessionSource", () => {
  it("reports stillOpen and the latest Evergreen download", async () => {
    const raw = source();
    const closed = await sessionSource({ sessionId: SID, name: "Source" }, raw, TARGET);
    expect(closed.kind).toBe("session");
    expect(closed.name).toBe("Source");
    expect(closed.stillOpen).toBe(false);
    expect(closed.evergreen).toEqual({
      kind: "xacts",
      at: 7000,
      employee: dev("a").toUpperCase(),
      workstation: "",
    });
    expect(closed.records).toEqual(await rewriteSession(raw, SID, TARGET));

    const open = await sessionSource({ sessionId: SID, name: "Source" }, raw.slice(0, 6), TARGET);
    expect(open.stillOpen).toBe(true);
    expect(open.evergreen).toBeNull();
  });
});
