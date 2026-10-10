import { describe, expect, it, vi } from "vite-plus/test";
import { mk } from "../log/helpers.test-util";
import type { LogRecord } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import { SyncEngine, type MeshLike, type StoreLike } from "./sync";

type Handler = (peerId: string, msg: unknown) => void;

function setup(initial: LogRecord[] = [], opts: { batch?: number } = {}) {
  const recs = new Map(initial.map((r) => [`${r.deviceId}:${r.seq}`, r]));
  const store: StoreLike = {
    sessionId: "S",
    put: async (rs) => {
      const fresh: LogRecord[] = [];
      for (const r of rs) {
        const k = `${r.deviceId}:${r.seq}`;
        if (r.sessionId !== "S" || recs.has(k)) continue;
        recs.set(k, r);
        fresh.push(r);
      }
      return fresh;
    },
    since: async (v) => missingFor(recs.values(), v),
    vector: async () => vectorOf(recs.values()),
  };
  let handler: Handler = () => {};
  const sent: Array<{ to: string; msg: any }> = [];
  const broadcasts: unknown[] = [];
  const mesh: MeshLike = {
    send: (to, msg) => (sent.push({ to, msg }), true),
    broadcast: (m) => void broadcasts.push(m),
    onMessage: (cb) => ((handler = cb), () => (handler = () => {})),
    onPeerChange: () => () => {},
    peers: () => [],
  };
  const onRecords = vi.fn();
  const engine = new SyncEngine({ mesh, store, onRecords, ...opts });
  engine.start();
  return { engine, deliver: (m: unknown) => handler("p", m), sent, broadcasts, onRecords };
}

const body = { type: "patron-started", patron: "P" } as const;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SyncEngine", () => {
  it("answers a vec with exactly the missing records", async () => {
    const own = [1, 2, 3, 4].map((n) => mk("a", n, body));
    const { deliver, sent } = setup(own);
    deliver({ t: "vec", vector: { a: 1 } });
    await flush();
    const reply = sent.find((s) => s.msg.t === "recs")!;
    expect(reply.to).toBe("p");
    expect(reply.msg.records.map((r: LogRecord) => r.seq)).toEqual([2, 3, 4]);
  });

  it("chunks replies by batch", async () => {
    const own = [1, 2, 3, 4, 5].map((n) => mk("a", n, body));
    const { deliver, sent } = setup(own, { batch: 2 });
    deliver({ t: "vec", vector: {} });
    await flush();
    const sizes = sent.filter((s) => s.msg.t === "recs").map((s) => s.msg.records.length);
    expect(sizes).toEqual([2, 2, 1]);
  });

  it("does not pass foreign-session records to onRecords", async () => {
    const { deliver, onRecords } = setup();
    deliver({
      t: "recs",
      records: [{ ...mk("a", 1, body), sessionId: "OTHER" }, mk("a", 2, body)],
    });
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(1);
    expect(onRecords.mock.calls[0][0].map((r: LogRecord) => r.seq)).toEqual([2]);
  });

  it("calls onRecords once for duplicate recs", async () => {
    const { deliver, onRecords } = setup();
    const m = { t: "recs", records: [mk("a", 1, body)] };
    deliver(m);
    deliver(m);
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed messages and records", async () => {
    const { deliver, onRecords, sent } = setup();
    deliver(null);
    deliver("x");
    deliver({ t: "nope" });
    deliver({ t: "recs", records: "bad" });
    deliver({ t: "vec", vector: [] });
    deliver({
      t: "recs",
      records: [
        { sessionId: "S", deviceId: 1, seq: 1 },
        { sessionId: "S", deviceId: "a", seq: 0 },
        { sessionId: "S", deviceId: "a", seq: 1.5 },
        null,
      ],
    });
    await flush();
    expect(onRecords).not.toHaveBeenCalled();
    expect(sent.filter((s) => s.msg.t === "recs")).toEqual([]);
  });

  it("pushLocal broadcasts immediately; stop is idempotent and silences handlers", async () => {
    const { engine, deliver, broadcasts, onRecords } = setup();
    const r = mk("a", 1, body);
    engine.pushLocal(r);
    expect(broadcasts).toEqual([{ t: "recs", records: [r] }]);
    engine.stop();
    engine.stop();
    deliver({ t: "recs", records: [mk("b", 1, body)] });
    await flush();
    expect(onRecords).not.toHaveBeenCalled();
  });
});
