import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { LogRecord } from "../log/types";
import {
  acquireSessionLock,
  createSession,
  getDeviceId,
  listSessions,
  openSessionStore,
  requestPersistence,
} from "./db";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function remote(sessionId: string, deviceId: string, seq: number): LogRecord {
  return {
    sessionId,
    deviceId,
    seq,
    employee: "Rae",
    at: 1000 + seq,
    type: "patron-started",
    patron: "P1",
  };
}

describe("session store", () => {
  it("append assigns sequential seq with device id and employee, and continues after reopen", async () => {
    const dev = await getDeviceId();
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: false });
    const a = await s.append({ type: "patron-started", patron: "P1" });
    const b = await s.append({ type: "item-scanned", visitId: `${dev}:1`, item: "I1" });
    const c = await s.append({ type: "patron-ended", visitId: `${dev}:1` });
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(a.deviceId).toBe(dev);
    expect(a.employee).toBe("Ann");
    expect(a.sessionId).toBe(s.sessionId);
    expect(typeof a.at).toBe("number");
    s.close();
    const again = await openSessionStore(s.sessionId);
    const d = await again.append({ type: "session-closed" });
    expect(d.seq).toBe(4);
    again.close();
  });

  it("setEmployee changes the employee on later records", async () => {
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: false });
    await s.setEmployee("Bo");
    expect((await s.meta()).employee).toBe("Bo");
    expect((await s.append({ type: "session-closed" })).employee).toBe("Bo");
  });

  it("withCreatedRecord appends session-created as seq 1", async () => {
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: true });
    const all = await s.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ type: "session-created", name: "Fair", seq: 1 });
    expect((await s.meta()).nextSeq).toBe(2);
  });

  it("concurrent appends never reuse or skip a seq", async () => {
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: false });
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => s.append({ type: "patron-started", patron: "P" })),
    );
    expect(rs.map((r) => r.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("put ignores duplicates and foreign sessions", async () => {
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: false });
    const r = remote(s.sessionId, "x", 1);
    expect(await s.put([r])).toEqual([r]);
    expect(await s.put([r])).toEqual([]);
    expect(await s.put([remote("other", "y", 1)])).toEqual([]);
    expect(await s.all()).toHaveLength(1);
  });

  it("since and vector", async () => {
    const dev = await getDeviceId();
    const s = await createSession({ name: "Fair", employee: "Ann", withCreatedRecord: false });
    for (let i = 0; i < 3; i++) await s.append({ type: "patron-started", patron: "P" });
    expect((await s.since({ [dev]: 2 })).map((r) => r.seq)).toEqual([3]);
    await s.put([remote(s.sessionId, "x", 1), remote(s.sessionId, "x", 3)]);
    expect(await s.vector()).toEqual({ x: 1, [dev]: 3 });
  });

  it("openSessionStore throws for unknown session", async () => {
    await expect(openSessionStore("nope")).rejects.toThrow();
  });

  it("joiner uses supplied sessionId", async () => {
    const s = await createSession({
      sessionId: "abc",
      name: "Fair",
      employee: "Ann",
      withCreatedRecord: false,
    });
    expect(s.sessionId).toBe("abc");
    expect(await s.all()).toEqual([]);
  });
});

describe("index", () => {
  it("getDeviceId is stable", async () => {
    expect(await getDeviceId()).toBe(await getDeviceId());
  });

  it("listSessions returns newest first", async () => {
    const a = await createSession({ name: "A", employee: "Ann", withCreatedRecord: false });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSession({ name: "B", employee: "Ann", withCreatedRecord: false });
    const list = await listSessions();
    expect(list.map((x) => x.sessionId)).toEqual([b.sessionId, a.sessionId]);
    expect(list[0]).toMatchObject({ name: "B", employee: "Ann" });
  });
});

describe("tab lock", () => {
  it("is exclusive until released", async () => {
    const held = new Set<string>();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request(name: string, _o: unknown, cb: (l: object | null) => Promise<void>) {
            if (held.has(name)) return Promise.resolve(cb(null));
            held.add(name);
            return cb({}).finally(() => held.delete(name));
          },
        },
      },
    });
    const rel = await acquireSessionLock("s1");
    expect(typeof rel).toBe("function");
    expect(await acquireSessionLock("s1")).toBeNull();
    rel!();
    await new Promise((r) => setTimeout(r, 0));
    expect(typeof (await acquireSessionLock("s1"))).toBe("function");
  });

  it("requestPersistence is false when unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    expect(await requestPersistence()).toBe(false);
  });
});
