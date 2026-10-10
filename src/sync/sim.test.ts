import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { dev, mk, SID } from "../log/helpers.test-util";
import { reduce } from "../log/reduce";
import type { LogRecord } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import type { PeerInfo } from "../mesh/mesh";
import { SyncEngine, type MeshLike, type StoreLike } from "./sync";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FakeMeshNetwork {
  private links = new Set<string>();
  private nodes = new Map<
    string,
    {
      msg: Set<(peerId: string, msg: unknown) => void>;
      peer: Set<(peers: PeerInfo[]) => void>;
    }
  >();
  private rand: () => number;
  private ids: string[];
  constructor(rand: () => number, ids: string[]) {
    this.rand = rand;
    this.ids = ids;
    for (const id of ids) this.nodes.set(id, { msg: new Set(), peer: new Set() });
  }
  private key(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
  isUp(a: string, b: string) {
    return this.links.has(this.key(a, b));
  }
  setLink(a: string, b: string, up: boolean) {
    if (this.isUp(a, b) === up) return;
    if (up) this.links.add(this.key(a, b));
    else this.links.delete(this.key(a, b));
    for (const id of [a, b]) {
      const peers = this.peersOf(id);
      for (const cb of this.nodes.get(id)!.peer) cb(peers);
    }
  }
  private peersOf(id: string): PeerInfo[] {
    return this.ids
      .filter((o) => o !== id)
      .map((o) => ({ deviceId: o, employee: o, connected: this.isUp(id, o) }));
  }
  private deliver(from: string, to: string, msg: unknown) {
    // Random latency gives reordering; in-flight messages die with the link.
    const copies = this.rand() < 0.25 ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      setTimeout(
        () => {
          if (!this.isUp(from, to)) return;
          for (const cb of this.nodes.get(to)!.msg) cb(from, structuredClone(msg));
        },
        Math.floor(this.rand() * 800),
      );
    }
  }
  meshFor(id: string): MeshLike {
    const node = this.nodes.get(id)!;
    const send = (to: string, msg: unknown) => {
      if (!this.isUp(id, to)) return false;
      this.deliver(id, to, msg);
      return true;
    };
    return {
      deviceId: id,
      send,
      broadcast: (msg) => {
        for (const o of this.ids) if (o !== id) send(o, msg);
      },
      onMessage: (cb) => (node.msg.add(cb), () => node.msg.delete(cb)),
      onPeerChange: (cb) => (node.peer.add(cb), () => node.peer.delete(cb)),
      peers: () => this.peersOf(id),
    };
  }
}

function memStore(): StoreLike & { records: Map<string, LogRecord> } {
  const records = new Map<string, LogRecord>();
  return {
    records,
    sessionId: SID,
    put: async (rs) => {
      const fresh: LogRecord[] = [];
      for (const r of rs) {
        const k = `${r.deviceId}:${r.seq}`;
        if (r.sessionId !== SID || records.has(k)) continue;
        records.set(k, r);
        fresh.push(r);
      }
      return fresh;
    },
    since: async (v) => missingFor(records.values(), v),
    vector: async () => vectorOf(records.values()),
  };
}

const sorted = (m: Map<string, LogRecord>) => [...m.keys()].sort();

describe("three-peer simulation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`converges despite link drops, reordering and duplicates (seed ${seed})`, async () => {
      const rand = mulberry32(seed);
      const [a, b, c] = ["a", "b", "c"].map(dev);
      const ids = [a, b, c];
      const net = new FakeMeshNetwork(rand, ids);
      for (const [x, y] of [
        [a, b],
        [b, c],
        [a, c],
      ])
        net.setLink(x, y, true);

      const stores = new Map(ids.map((id) => [id, memStore()]));
      const nexts = new Map(ids.map((id) => [id, 1]));
      const fresh = new Map<string, number>(ids.map((id) => [id, 0]));
      const engines = new Map(
        ids.map((id) => [
          id,
          new SyncEngine({
            mesh: net.meshFor(id),
            store: stores.get(id)!,
            onRecords: (rs) => fresh.set(id, fresh.get(id)! + rs.length),
          }),
        ]),
      );
      for (const e of engines.values()) e.start();

      const append = async (id: string) => {
        const seq = nexts.get(id)!;
        nexts.set(id, seq + 1);
        const r =
          seq === 1
            ? mk(id, 1, { type: "patron-started", patron: `P${id.toUpperCase()}` })
            : mk(id, seq, {
                type: "item-scanned",
                visitId: `${id}:1`,
                item: `I${id.toUpperCase()}${seq}`,
              });
        await stores.get(id)!.put([r]);
        engines.get(id)!.pushLocal(r);
      };

      for (let round = 0; round < 10; round++) {
        if (round === 3) net.setLink(a, c, false);
        if (round === 6) {
          net.setLink(a, c, true);
          net.setLink(a, b, false);
          net.setLink(b, c, false);
        }
        if (round === 9) {
          net.setLink(a, b, true);
          net.setLink(b, c, true);
        }
        for (const id of ids) for (let i = 0; i < 3; i++) await append(id);
        await vi.advanceTimersByTimeAsync(1000);
      }
      await vi.advanceTimersByTimeAsync(30_000);

      const ref = sorted(stores.get(a)!.records);
      expect(ref).toHaveLength(90);
      for (const id of [b, c]) expect(sorted(stores.get(id)!.records)).toEqual(ref);
      const states = ids.map((id) => reduce(stores.get(id)!.records.values()));
      expect(states[1]).toEqual(states[0]);
      expect(states[2]).toEqual(states[0]);
      expect(states[0].totals).toEqual({ patrons: 3, items: 87 });
      // each node saw exactly the 60 foreign records as fresh, once
      for (const id of ids) expect(fresh.get(id)).toBe(60);

      for (const e of engines.values()) e.stop();
    });
  }
});
