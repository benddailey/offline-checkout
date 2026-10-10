import type { LogRecord, VersionVector } from "../log/types";
import { isLogRecord } from "../log/validate";
import type { Mesh } from "../mesh/mesh";
import type { SessionStore } from "../store/db";

export type MeshLike = Pick<
  Mesh,
  "deviceId" | "send" | "broadcast" | "onMessage" | "onPeerChange" | "peers"
>;
export type StoreLike = Pick<SessionStore, "put" | "since" | "vector" | "sessionId">;

type SyncMsg = { t: "vec"; vector: VersionVector } | { t: "recs"; records: unknown[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMsg(msg: unknown): SyncMsg | null {
  if (!isObject(msg)) return null;
  if (
    msg.t === "vec" &&
    isObject(msg.vector) &&
    Object.values(msg.vector).every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
  ) {
    return { t: "vec", vector: msg.vector as VersionVector };
  }
  if (msg.t === "recs" && Array.isArray(msg.records)) {
    return { t: "recs", records: msg.records };
  }
  return null;
}

export class SyncEngine {
  private readonly mesh: MeshLike;
  private readonly store: StoreLike;
  private readonly onRecords: (fresh: LogRecord[]) => void;
  private readonly intervalMs: number;
  private readonly batch: number;
  private unsubs: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private connected = new Set<string>();
  private writes: Promise<void> = Promise.resolve();
  private running = false;

  constructor(o: {
    mesh: MeshLike;
    store: StoreLike;
    onRecords: (fresh: LogRecord[]) => void;
    intervalMs?: number;
    batch?: number;
  }) {
    this.mesh = o.mesh;
    this.store = o.store;
    this.onRecords = o.onRecords;
    this.intervalMs = o.intervalMs ?? 10_000;
    this.batch = Math.max(1, o.batch ?? 200);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connected = new Set(this.connectedIds(this.mesh.peers()));
    this.unsubs.push(
      this.mesh.onMessage((peerId, msg) => this.handle(peerId, msg)),
      this.mesh.onPeerChange((peers) => {
        const now = new Set(this.connectedIds(peers));
        const fresh = [...now].filter((id) => !this.connected.has(id));
        this.connected = now;
        if (fresh.length) void this.sendVec(fresh);
      }),
    );
    this.timer = setInterval(() => void this.sendVec(), this.intervalMs);
    void this.sendVec();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  pushLocal(r: LogRecord): void {
    this.mesh.broadcast({ t: "recs", records: [r] });
  }

  private connectedIds(peers: { deviceId: string; connected: boolean }[]): string[] {
    return peers.filter((p) => p.connected).map((p) => p.deviceId);
  }

  /** Send our vector to the given peers, or to every connected peer. */
  private async sendVec(to?: string[]): Promise<void> {
    try {
      const vector = await this.store.vector();
      if (!this.running) return;
      const targets = to ?? this.connectedIds(this.mesh.peers());
      for (const id of targets) this.mesh.send(id, { t: "vec", vector });
    } catch (err) {
      console.error("sync: could not send version vector", err);
    }
  }

  private handle(peerId: string, raw: unknown): void {
    const msg = parseMsg(raw);
    if (!msg || !this.running) return;
    if (msg.t === "vec") void this.reply(peerId, msg.vector);
    else this.enqueue(msg.records);
  }

  private async reply(peerId: string, theirs: VersionVector): Promise<void> {
    try {
      const records = await this.store.since(theirs);
      for (let i = 0; i < records.length; i += this.batch) {
        if (!this.running) return;
        this.mesh.send(peerId, { t: "recs", records: records.slice(i, i + this.batch) });
      }
    } catch (err) {
      console.error("sync: could not reply to version vector", err);
    }
  }

  private enqueue(candidates: unknown[]): void {
    // A peer never holds a record of ours that we lack: one with our deviceId is forged or stale
    // and would collide with our next local append.
    const valid = candidates.filter(
      (r): r is LogRecord =>
        isLogRecord(r) && r.sessionId === this.store.sessionId && r.deviceId !== this.mesh.deviceId,
    );
    if (!valid.length) return;
    this.writes = this.writes.then(async () => {
      let fresh: LogRecord[];
      try {
        fresh = await this.store.put(valid);
      } catch (err) {
        // the next vector exchange re-requests these records
        console.error("sync: store.put failed", err);
        return;
      }
      if (!fresh.length || !this.running) return;
      try {
        this.onRecords(fresh);
      } catch (err) {
        console.error("sync: onRecords threw", err);
      }
    });
  }
}
