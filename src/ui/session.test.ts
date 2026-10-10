import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { recordId } from "../log/ids";
import type { LogRecord, RecordBody, VersionVector } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import type { Mesh, PeerInfo } from "../mesh/mesh";
import type { PairingPayload } from "../pairing/payload";
import type { SessionMeta, SessionStore, SessionSummary } from "../store/db";
import { createSessionStoreDeps, setSessionDeps, useSession } from "./session";

const DEVICE = "dev-a";
const tick = () => new Promise((r) => setTimeout(r, 0));

/** In-memory stand-in for src/store/db.ts; append resolves after a random 0–20 ms. */
function fakeDb() {
  const metas = new Map<string, SessionMeta>();
  const logs = new Map<string, LogRecord[]>();
  const locks = new Set<string>();
  let failAppends = false;
  let gate: Promise<void> = Promise.resolve();
  let lockAvailable = true;
  let persistCalls = 0;
  let nextId = 1;

  function makeStore(sessionId: string): SessionStore {
    const log = logs.get(sessionId)!;
    const meta = metas.get(sessionId)!;
    return {
      sessionId,
      meta: async () => ({ ...meta }),
      async setEmployee(name) {
        meta.employee = name;
      },
      append(body: RecordBody) {
        if (failAppends) {
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error("QuotaExceededError")), Math.random() * 20),
          );
        }
        const record = {
          sessionId,
          deviceId: meta.deviceId,
          seq: meta.nextSeq++,
          employee: meta.employee,
          at: 1000 + meta.nextSeq,
          ...body,
        } as LogRecord;
        log.push(record);
        return gate.then(
          () => new Promise((resolve) => setTimeout(() => resolve(record), Math.random() * 20)),
        );
      },
      async put(records) {
        const fresh = records.filter(
          (r) => r.sessionId === sessionId && !log.some((l) => recordId(l) === recordId(r)),
        );
        log.push(...fresh);
        return fresh;
      },
      all: async () => [...log],
      since: async (theirs: VersionVector) => missingFor(log, theirs),
      vector: async () => vectorOf(log),
      close() {},
    };
  }

  const deps = createSessionStoreDeps({
    now: () => new Date(2026, 9, 10, 9, 30),
    async createSession(o) {
      const sessionId = o.sessionId ?? `s${nextId++}`;
      if (!metas.has(sessionId)) {
        metas.set(sessionId, {
          sessionId,
          name: o.name,
          deviceId: DEVICE,
          employee: o.employee,
          nextSeq: 1,
          createdAt: 0,
        });
        logs.set(sessionId, []);
        const store = makeStore(sessionId);
        if (o.withCreatedRecord) await store.append({ type: "session-created", name: o.name });
        return store;
      }
      return makeStore(sessionId);
    },
    async openSessionStore(sessionId) {
      if (!metas.has(sessionId)) throw new Error("Unknown session");
      return makeStore(sessionId);
    },
    async listSessions(): Promise<SessionSummary[]> {
      return [...metas.values()].map((m) => ({
        sessionId: m.sessionId,
        name: m.name,
        employee: m.employee,
        createdAt: m.createdAt,
      }));
    },
    async acquireSessionLock(sessionId) {
      if (!lockAvailable || locks.has(sessionId)) return null;
      locks.add(sessionId);
      return () => locks.delete(sessionId);
    },
    async requestPersistence() {
      persistCalls++;
      return true;
    },
    renderSessionPdf: () => new Blob(["pdf"]),
    renderScannerCard: () => new Blob(["card"]),
    downloadBlob: (_blob, filename) => downloads.push(filename),
  });
  const downloads: string[] = [];

  return {
    deps,
    metas,
    logs,
    locks,
    downloads,
    failAppends(v: boolean) {
      failAppends = v;
    },
    lockAvailable(v: boolean) {
      lockAvailable = v;
    },
    persistCalls: () => persistCalls,
    /** Hold every append until the returned function is called. */
    holdAppends() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        release();
        gate = Promise.resolve();
      };
    },
  };
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  db = fakeDb();
  setSessionDeps(db.deps);
  setActivePinia(createPinia());
});

/** A fresh Pinia instance, as after a page reload, reading the same fake database. */
function reload() {
  db.locks.clear();
  setActivePinia(createPinia());
  return useSession();
}

async function started() {
  const s = useSession();
  await s.startSession("2026-10-10", "Rae");
  return s;
}

const types = (rs: LogRecord[]) => rs.map((r) => r.type);

describe("useSession scanning", () => {
  it("starts a session on the scan screen with a session-created record", async () => {
    const s = await started();
    expect(s.screen).toBe("scan");
    expect(s.meta?.name).toBe("2026-10-10");
    expect(s.meta?.employee).toBe("Rae");
    expect(types(s.records)).toEqual(["session-created"]);
    expect(s.isolated).toBe(true);
    expect(s.peers).toEqual([]);
    expect(db.persistCalls()).toBe(1);
  });

  it("processes 10 scans fired without awaiting in exactly arrival order", async () => {
    const s = await started();
    const codes = ["P1", ...Array.from({ length: 9 }, (_, i) => `I${i + 1}`)];
    const pending = codes.map((c) => s.scan(c));
    await Promise.all(pending);
    const scans = s.records.filter((r) => r.type !== "session-created");
    expect(scans).toHaveLength(10);
    expect(scans[0]).toMatchObject({ type: "patron-started", patron: "P1" });
    expect(scans.slice(1).map((r) => (r.type === "item-scanned" ? r.item : r.type))).toEqual(
      codes.slice(1),
    );
    expect(scans.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => i + 2));
    expect(s.state.totals).toEqual({ patrons: 1, items: 9 });
  });

  it("shows a record only after its append resolves", async () => {
    const s = await started();
    const release = db.holdAppends();
    const p = s.scan("P1");
    await tick();
    // the fake log already holds the record but the store must wait for the commit
    expect(db.logs.get(s.meta!.sessionId)).toHaveLength(2);
    expect(s.records).toHaveLength(1);
    release();
    await p;
    expect(s.records).toHaveLength(2);
  });

  it("trims and upper-cases a patron scan", async () => {
    const s = await started();
    await s.scan(" p1 ");
    expect(s.currentVisit?.patron).toBe("P1");
    expect(s.currentVisitId).toBe(recordId(s.records[1]));
  });

  it("ignores empty scans", async () => {
    const s = await started();
    await s.scan("   ");
    expect(s.records).toHaveLength(1);
    expect(s.message).toBeNull();
  });

  it("rejects non-Code 39 barcodes with a reason", async () => {
    const s = await started();
    await s.scan("P1#");
    expect(s.records).toHaveLength(1);
    expect(s.message?.tone).toBe("error");
    expect(s.message?.text).toContain('"#"');
  });

  it("warns and does not add the same item twice on one patron", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("I1");
    await s.scan("I1");
    expect(s.records.filter((r) => r.type === "item-scanned")).toHaveLength(1);
    expect(s.message).toEqual({ tone: "warn", text: "Already on this patron — not added" });
  });

  it("adds an item already on another patron, warning with that patron's barcode", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("I1");
    await s.scan("OC-END");
    await s.scan("P2");
    await s.scan("I1");
    expect(s.records.filter((r) => r.type === "item-scanned")).toHaveLength(2);
    expect(s.message).toEqual({ tone: "warn", text: "Also on patron P1" });
  });

  it("OC-VOIDLAST voids the most recent non-voided item", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("I1");
    await s.scan("I2");
    await s.scan("OC-VOIDLAST");
    await s.scan("OC-VOIDLAST");
    const items = s.currentVisit!.items;
    expect(items.map((i) => [i.barcode, i.voided])).toEqual([
      ["I1", true],
      ["I2", true],
    ]);
    await s.scan("oc-voidlast");
    expect(s.message).toEqual({ tone: "info", text: "Nothing to void" });
    expect(s.records.filter((r) => r.type === "voided")).toHaveLength(2);
  });

  it("OC-END ends the current visit; with no visit it only informs", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("OC-END");
    expect(s.currentVisitId).toBeNull();
    expect(s.currentVisit).toBeNull();
    expect(s.state.visits[0].ended).toBe(true);
    await s.scan("OC-END");
    expect(s.message?.tone).toBe("info");
    expect(s.records.filter((r) => r.type === "patron-ended")).toHaveLength(1);
    await s.scan("P2");
    expect(s.currentVisit?.patron).toBe("P2");
  });

  it("voidRecord, endPatron and voidPatron append the right records", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("I1");
    await s.voidRecord(s.currentVisit!.items[0].id);
    expect(s.currentVisit!.items[0].voided).toBe(true);
    await s.endPatron();
    expect(s.currentVisitId).toBeNull();
    await s.scan("P2");
    const visit = s.currentVisitId!;
    await s.voidPatron();
    expect(s.currentVisitId).toBeNull();
    expect(s.state.visits.find((v) => v.id === visit)?.voided).toBe(true);
    expect(s.state.totals).toEqual({ patrons: 1, items: 0 });
  });

  it("rejects scans after closeSession with an error and no record", async () => {
    const s = await started();
    await s.scan("P1");
    await s.closeSession();
    expect(s.closed).toBe(true);
    const before = s.records.length;
    await s.scan("I1");
    expect(s.records).toHaveLength(before);
    expect(s.message).toEqual({ tone: "error", text: "Session closed" });
  });

  it("sets fatal and shows no record when append rejects; later scans are refused", async () => {
    const s = await started();
    db.failAppends(true);
    await s.scan("P1");
    expect(s.records).toHaveLength(1);
    expect(s.fatal).toMatch(/^Could not save the scan/);
    expect(s.fatal).toContain("Do not continue scanning on this workstation.");
    db.failAppends(false);
    await s.scan("P2");
    expect(s.records).toHaveLength(1);
  });

  it("resume restores this device's open visit", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("OC-END");
    await s.scan("P2");
    await s.scan("I1");
    const open = s.currentVisitId;
    const sessionId = s.meta!.sessionId;

    const r = reload();
    await r.resumeSession(sessionId);
    expect(r.screen).toBe("scan");
    expect(r.currentVisitId).toBe(open);
    expect(r.currentVisit?.patron).toBe("P2");
    expect(r.state.totals).toEqual({ patrons: 2, items: 1 });
    expect(r.isolated).toBe(true);
    expect(db.persistCalls()).toBe(2);
  });

  it("resume after OC-END has no current visit", async () => {
    const s = await started();
    await s.scan("P1");
    await s.scan("OC-END");
    const r = reload();
    await r.resumeSession(s.meta!.sessionId);
    expect(r.currentVisitId).toBeNull();
  });

  it("sets fatal when the session lock is held elsewhere", async () => {
    const s = await started();
    const sessionId = s.meta!.sessionId;
    setActivePinia(createPinia());
    const other = useSession();
    await other.resumeSession(sessionId); // lock still held by the first store
    expect(other.fatal).toBe("This session is already open in another tab");
    expect(other.screen).toBe("launch");

    db.lockAvailable(false);
    setActivePinia(createPinia());
    const third = useSession();
    await third.startSession("X", "Rae");
    expect(third.fatal).toBe("This session is already open in another tab");
  });

  it("lists stored sessions", async () => {
    await started();
    const list = await useSession().listSessions();
    expect(list.map((x) => x.name)).toEqual(["2026-10-10"]);
  });
});

describe("useSession files", () => {
  it("generatePdf is a no-op with zero patrons and names the file after the session", async () => {
    const s = useSession();
    await s.startSession("Main Desk / Fri", "Rae");
    s.generatePdf();
    expect(db.downloads).toEqual([]);
    await s.scan("P1");
    s.generatePdf();
    s.printScannerCard();
    expect(db.downloads).toEqual([
      "offline-checkout-Main-Desk-Fri-2026-10-10.pdf",
      "offline-checkout-scanner-card.pdf",
    ]);
  });
});

/** A MeshLike fake that lets the test drive peer changes and inbound messages. */
function fakeMesh(initial: PeerInfo[] = []) {
  const msgCbs = new Set<(peer: string, msg: unknown) => void>();
  const peerCbs = new Set<(peers: PeerInfo[]) => void>();
  let peers = initial;
  const sent: unknown[] = [];
  const employees: string[] = [];
  const mesh = {
    send: (_id: string, msg: unknown) => (sent.push(msg), true),
    broadcast: (msg: unknown) => void sent.push(msg),
    onMessage(cb: (peer: string, msg: unknown) => void) {
      msgCbs.add(cb);
      return () => msgCbs.delete(cb);
    },
    onPeerChange(cb: (p: PeerInfo[]) => void) {
      peerCbs.add(cb);
      return () => peerCbs.delete(cb);
    },
    peers: () => peers,
    setEmployee: (name: string) => void employees.push(name),
    close() {},
  };
  return {
    mesh: mesh as unknown as Mesh,
    sent,
    employees,
    setPeers(p: PeerInfo[]) {
      peers = p;
      for (const cb of peerCbs) cb(p);
    },
    deliver(peer: string, msg: unknown) {
      for (const cb of msgCbs) cb(peer, msg);
    },
  };
}

describe("useSession mesh", () => {
  it("mirrors peers, pushes local records and merges remote ones once", async () => {
    const s = await started();
    const m = fakeMesh();
    s.attachMesh(m.mesh);
    expect(s.isolated).toBe(true);
    expect(m.employees).toEqual(["Rae"]);

    m.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    expect(s.peers).toEqual([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    expect(s.isolated).toBe(false);

    await s.scan("P1");
    expect(m.sent).toContainEqual({ t: "recs", records: [s.records[1]] });

    const sessionId = s.meta!.sessionId;
    const remote: LogRecord = {
      sessionId,
      deviceId: "dev-b",
      seq: 1,
      employee: "Sam",
      at: 5000,
      type: "patron-started",
      patron: "P9",
    };
    m.deliver("dev-b", { t: "recs", records: [remote] });
    m.deliver("dev-b", { t: "recs", records: [remote] });
    await tick();
    await tick();
    expect(s.records.filter((r) => r.deviceId === "dev-b")).toHaveLength(1);
    expect(s.state.totals.patrons).toBe(2);
    expect(s.knownDevices()).toEqual(new Set([DEVICE, "dev-b"]));

    m.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: false }]);
    expect(s.isolated).toBe(true);
  });

  it("a remote session-closed stops local scanning", async () => {
    const s = await started();
    const m = fakeMesh([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    s.attachMesh(m.mesh);
    m.deliver("dev-b", {
      t: "recs",
      records: [
        {
          sessionId: s.meta!.sessionId,
          deviceId: "dev-b",
          seq: 1,
          employee: "Sam",
          at: 5000,
          type: "session-closed",
        },
      ],
    });
    await tick();
    await tick();
    expect(s.closed).toBe(true);
    await s.scan("P1");
    expect(s.message).toEqual({ tone: "error", text: "Session closed" });
  });

  it("adoptJoinedSession creates the local copy without a created record and attaches the mesh", async () => {
    const s = useSession();
    const m = fakeMesh([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    const offer = {
      kind: "offer",
      sessionId: "joined-1",
      sessionName: "Outage",
      deviceId: "dev-b",
      employee: "Sam",
      sdp: {},
    } as unknown as PairingPayload;
    await s.adoptJoinedSession(offer, "Lee", m.mesh);
    expect(s.screen).toBe("scan");
    expect(s.meta).toMatchObject({ sessionId: "joined-1", name: "Outage", employee: "Lee" });
    expect(s.records).toEqual([]);
    expect(s.isolated).toBe(false);
    expect(s.mesh).toBe(m.mesh);
    expect(db.locks.has("joined-1")).toBe(true);
    expect(db.persistCalls()).toBe(1);
  });
});
