import { describe, expect, it, vi } from "vite-plus/test";
import { dev, mk, SID } from "../log/helpers.test-util";
import type { LogRecord } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import type { PeerInfo } from "../mesh/mesh";
import { SyncEngine, type MeshLike, type StoreLike } from "./sync";

type Handler = (peerId: string, msg: unknown) => void;

/** This machine's device id. */
const OWN = dev("o");

function setup(initial: LogRecord[] = [], opts: { batch?: number; putGate?: Promise<void> } = {}) {
  const recs = new Map(initial.map((r) => [`${r.deviceId}:${r.seq}`, r]));
  const store: StoreLike = {
    sessionId: SID,
    put: async (rs) => {
      await opts.putGate;
      const fresh: LogRecord[] = [];
      for (const r of rs) {
        const k = `${r.deviceId}:${r.seq}`;
        if (r.sessionId !== SID || recs.has(k)) continue;
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
    deviceId: OWN,
    send: (to, msg) => (sent.push({ to, msg }), true),
    broadcast: (m) => void broadcasts.push(m),
    onMessage: (cb) => ((handler = cb), () => (handler = () => {})),
    onPeerChange: () => () => {},
    peers: () => [],
  };
  const onRecords = vi.fn();
  const engine = new SyncEngine({ mesh, store, onRecords, batch: opts.batch });
  engine.start();
  return { engine, deliver: (m: unknown) => handler("p", m), sent, broadcasts, onRecords };
}

const body = { type: "patron-started", patron: "P" } as const;
const A = dev("a");
const B = dev("b");
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SyncEngine", () => {
  it("answers a vec with exactly the missing records", async () => {
    const own = [1, 2, 3, 4].map((n) => mk(A, n, body));
    const { deliver, sent } = setup(own);
    deliver({ t: "vec", vector: { [A]: 1 } });
    await flush();
    const reply = sent.find((s) => s.msg.t === "recs")!;
    expect(reply.to).toBe("p");
    expect(reply.msg.records.map((r: LogRecord) => r.seq)).toEqual([2, 3, 4]);
  });

  it("chunks replies by batch", async () => {
    const own = [1, 2, 3, 4, 5].map((n) => mk(A, n, body));
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
      records: [{ ...mk(A, 1, body), sessionId: "OTHER" }, mk(A, 2, body)],
    });
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(1);
    expect(onRecords.mock.calls[0][0].map((r: LogRecord) => r.seq)).toEqual([2]);
  });

  it("calls onRecords once for duplicate recs", async () => {
    const { deliver, onRecords } = setup();
    const m = { t: "recs", records: [mk(A, 1, body)] };
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
    deliver({ t: "vec", vector: { a: -1 } });
    deliver({ t: "vec", vector: { a: 1.5 } });
    deliver({ t: "vec", vector: { a: "1" } });
    deliver({
      t: "recs",
      records: [
        { ...mk(A, 1, body), type: "bogus" },
        { ...mk(A, 2, body), patron: undefined },
      ],
    });
    deliver({
      t: "recs",
      records: [
        { sessionId: SID, deviceId: 1, seq: 1 },
        { sessionId: SID, deviceId: A, seq: 0 },
        { sessionId: SID, deviceId: A, seq: 1.5 },
        null,
      ],
    });
    await flush();
    expect(onRecords).not.toHaveBeenCalled();
    expect(sent.filter((s) => s.msg.t === "recs")).toEqual([]);
  });

  it("drops well-formed records whose barcodes the PDF could not print", async () => {
    const { deliver, onRecords } = setup();
    deliver({
      t: "recs",
      records: [
        mk(A, 1, { type: "patron-started", patron: "p1" }),
        mk(A, 2, { type: "patron-started", patron: "OC-END" }),
        mk(A, 3, { type: "item-scanned", visitId: `${A}:9`, item: "OC-VOIDLAST" }),
        mk(A, 4, { type: "item-scanned", visitId: `${A}:9`, item: "I".repeat(65) }),
        mk(A, 5, { type: "patron-started", patron: "P#" }),
        mk(A, 6, body),
      ],
    });
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(1);
    expect(onRecords.mock.calls[0][0].map((r: LogRecord) => r.seq)).toEqual([6]);
  });

  it("drops records claiming to come from this machine", async () => {
    const { deliver, onRecords } = setup();
    deliver({ t: "recs", records: [mk(OWN, 1, body), mk(A, 1, body)] });
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(1);
    expect(onRecords.mock.calls[0][0].map((r: LogRecord) => r.deviceId)).toEqual([A]);
  });

  it("pushLocal broadcasts immediately", () => {
    const { engine, broadcasts } = setup();
    const r = mk(A, 1, body);
    engine.pushLocal(r);
    expect(broadcasts).toEqual([{ t: "recs", records: [r] }]);
  });

  it("stop is idempotent and queued writes do not notify after stop", async () => {
    let open!: () => void;
    const putGate = new Promise<void>((r) => (open = r));
    const { engine, deliver, onRecords } = setup([], { putGate });
    deliver({ t: "recs", records: [mk(B, 1, body)] });
    engine.stop();
    engine.stop();
    open();
    await flush();
    expect(onRecords).not.toHaveBeenCalled();
  });

  it("keeps notifying after onRecords throws, and logs it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deliver, onRecords } = setup();
    onRecords.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    deliver({ t: "recs", records: [mk(A, 1, body)] });
    deliver({ t: "recs", records: [mk(A, 2, body)] });
    await flush();
    expect(onRecords).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("SyncEngine vec scheduling", () => {
  it("sends vec on start, on newly connected peers only, and on the interval", async () => {
    vi.useFakeTimers();
    try {
      let peers: PeerInfo[] = [{ deviceId: "b", employee: "B", connected: true }];
      let notify: (p: PeerInfo[]) => void = () => {};
      const sent: Array<{ to: string; msg: any }> = [];
      const mesh: MeshLike = {
        deviceId: OWN,
        send: (to, msg) => (sent.push({ to, msg }), true),
        broadcast: () => {},
        onMessage: () => () => {},
        onPeerChange: (cb) => ((notify = cb), () => {}),
        peers: () => peers,
      };
      const store: StoreLike = {
        sessionId: SID,
        put: async () => [],
        since: async () => [],
        vector: async () => ({ a: 1 }),
      };
      const engine = new SyncEngine({ mesh, store, onRecords: () => {}, intervalMs: 10_000 });
      const vecTo = () => sent.filter((s) => s.msg.t === "vec").map((s) => s.to);
      engine.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(vecTo()).toEqual(["b"]);
      expect(sent[0].msg.vector).toEqual({ a: 1 });

      sent.length = 0;
      peers = [
        { deviceId: "b", employee: "B", connected: true },
        { deviceId: "c", employee: "C", connected: true },
      ];
      notify(peers);
      await vi.advanceTimersByTimeAsync(0);
      expect(vecTo()).toEqual(["c"]);

      sent.length = 0;
      peers = peers.map((p) => ({ ...p, employee: p.employee + "!" }));
      notify(peers);
      await vi.advanceTimersByTimeAsync(0);
      expect(vecTo()).toEqual([]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(vecTo()).toEqual(["b", "c"]);
      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
