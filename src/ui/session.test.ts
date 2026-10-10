import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { recordId } from "../log/ids";
import type { LogRecord, RecordBody, VersionVector } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import type { Mesh, MeshOptions, PeerInfo } from "../mesh/mesh";
import { encodePayload, type PairingPayload } from "../pairing/payload";
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
  let failSetEmployee = false;
  let failMeta = false;
  const closes = new Map<string, number>();
  const meshes: ReturnType<typeof fakeMesh>[] = [];
  const meshOptions: MeshOptions[] = [];
  let gate: Promise<void> = Promise.resolve();
  let lockAvailable = true;
  let persistCalls = 0;
  let nextId = 1;

  function makeStore(sessionId: string): SessionStore {
    const log = logs.get(sessionId)!;
    const meta = metas.get(sessionId)!;
    return {
      sessionId,
      async meta() {
        if (failMeta) throw new Error("meta unreadable");
        return { ...meta };
      },
      async setEmployee(name) {
        if (failSetEmployee) throw new Error("QuotaExceededError");
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
      close() {
        closes.set(sessionId, (closes.get(sessionId) ?? 0) + 1);
      },
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
    getDeviceId: async () => DEVICE,
    createMesh(o) {
      meshOptions.push(o);
      const m = fakeMesh();
      meshes.push(m);
      return m.mesh;
    },
  });
  const downloads: string[] = [];

  return {
    deps,
    metas,
    logs,
    locks,
    downloads,
    closes,
    meshes,
    meshOptions,
    failSetEmployee(v: boolean) {
      failSetEmployee = v;
    },
    failMeta(v: boolean) {
      failMeta = v;
    },
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
  const state = { closed: false };
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
    close() {
      state.closed = true;
    },
  };
  return {
    mesh: mesh as unknown as Mesh,
    state,
    listeners: () => msgCbs.size + peerCbs.size,
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

const FINGERPRINT = Array.from({ length: 32 }, () => "AB").join(":");

function code(kind: "offer" | "answer", sessionId: string, sessionName = "Outage"): string {
  return encodePayload({
    kind,
    sessionId,
    sessionName,
    deviceId: "dev-b",
    employee: "Sam",
    sdp: {
      ufrag: "abcd",
      pwd: "0123456789abcdefghijkl",
      fingerprint: FINGERPRINT,
      candidates: [{ address: "10.0.0.2", port: 50000 }],
    },
  });
}

function offerFor(sessionId: string): PairingPayload {
  return {
    kind: "offer",
    sessionId,
    sessionName: "Outage",
    deviceId: "dev-b",
    employee: "Sam",
    sdp: {},
  } as unknown as PairingPayload;
}

const remoteRecord = (sessionId: string): LogRecord => ({
  sessionId,
  deviceId: "dev-b",
  seq: 1,
  employee: "Sam",
  at: 5000,
  type: "patron-started",
  patron: "P9",
});

describe("useSession session lifecycle", () => {
  it("start and resume give the session its own mesh", async () => {
    const s = await started();
    const sessionId = s.meta!.sessionId;
    expect(db.meshOptions[0]).toMatchObject({
      sessionId,
      sessionName: "2026-10-10",
      deviceId: DEVICE,
      employee: "Rae",
    });
    expect(s.mesh).toBe(db.meshes[0]!.mesh);
    expect(db.meshOptions[0]!.knownDevices()).toEqual(new Set([DEVICE]));
    expect(s.isolated).toBe(true);

    const r = reload();
    await r.resumeSession(sessionId);
    expect(db.meshOptions[1]).toMatchObject({ sessionId, employee: "Rae" });
    expect(r.mesh).toBe(db.meshes[1]!.mesh);
  });

  it("switching sessions releases the old lock, stops its sync and closes its mesh", async () => {
    const s = await started();
    const first = s.meta!.sessionId;
    const m = db.meshes[0]!;
    expect(m.listeners()).toBeGreaterThan(0);

    await s.startSession("Second", "Rae");
    expect(s.meta!.sessionId).not.toBe(first);
    expect(db.locks.has(first)).toBe(false);
    expect(db.closes.get(first)).toBe(1);
    expect(m.state.closed).toBe(true);
    expect(m.listeners()).toBe(0);
    expect(s.mesh).toBe(db.meshes[1]!.mesh);

    m.deliver("dev-b", { t: "recs", records: [remoteRecord(first)] });
    await tick();
    expect(s.records.some((r) => r.deviceId === "dev-b")).toBe(false);
  });

  it("a scan in flight when the session switches is not shown in the new session", async () => {
    const s = await started();
    const first = s.meta!.sessionId;
    const release = db.holdAppends();
    const pending = s.scan("P1");
    await tick();
    const switching = s.startSession("Second", "Rae");
    release();
    await Promise.all([pending, switching]);
    expect(s.meta!.name).toBe("Second");
    expect(types(s.records)).toEqual(["session-created"]);
    expect(s.currentVisit).toBeNull();
    expect(db.logs.get(first)!.map((r) => r.type)).toContain("patron-started");
  });

  it("a scan queued for the old session does not run against the new one", async () => {
    const s = await started();
    const release = db.holdAppends();
    const busy = s.scan("P1");
    const queued = s.scan("P2");
    await tick();
    const switching = s.startSession("Second", "Rae");
    release();
    await Promise.all([busy, queued, switching]);
    expect(types(s.records)).toEqual(["session-created"]);
    expect(db.logs.get(s.meta!.sessionId)!.map((r) => r.type)).toEqual(["session-created"]);
  });

  it("endPatron is refused once the session is closed", async () => {
    const s = await started();
    await s.scan("P1");
    await s.closeSession();
    const count = s.records.length;
    await s.endPatron();
    expect(s.records).toHaveLength(count);
    expect(s.message).toEqual({ tone: "error", text: "Session closed" });
  });

  it("closes a created store once when the lock is held", async () => {
    db.lockAvailable(false);
    const s = useSession();
    await s.startSession("X", "Rae");
    expect(s.fatal).not.toBeNull();
    expect([...db.closes.values()]).toEqual([1]);
  });

  it("closes a created store once when loading it fails", async () => {
    db.failMeta(true);
    const s = useSession();
    await s.startSession("X", "Rae");
    expect(s.fatal).toMatch(/^Could not open the session/);
    expect([...db.closes.values()]).toEqual([1]);
    expect(db.locks.size).toBe(0);
  });
});

describe("useSession pairing", () => {
  it("attachMesh replacing a mesh closes the old one and syncs over the new one", async () => {
    const s = await started();
    const old = db.meshes[0]!;
    const next = fakeMesh([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    s.attachMesh(next.mesh);
    expect(old.state.closed).toBe(true);
    expect(old.listeners()).toBe(0);
    expect(s.peers).toEqual([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    expect(s.isolated).toBe(false);
    old.sent.length = 0;
    await s.scan("P1");
    expect(old.sent).toEqual([]);
    expect(next.sent).toContainEqual({ t: "recs", records: [s.records[1]] });
  });

  it("re-pair keeps the store, lock and records and swaps in the joined mesh", async () => {
    const s = await started();
    await s.scan("P1");
    const sessionId = s.meta!.sessionId;
    const old = db.meshes[0]!;
    const joined = fakeMesh([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    await s.adoptJoinedSession(offerFor(sessionId), " Lee ", joined.mesh);
    expect(s.meta).toMatchObject({ sessionId, employee: "Lee" });
    expect(db.metas.get(sessionId)!.employee).toBe("Lee");
    expect(types(s.records)).toEqual(["session-created", "patron-started"]);
    expect(s.currentVisit?.patron).toBe("P1");
    expect(db.locks.has(sessionId)).toBe(true);
    expect(db.closes.get(sessionId)).toBeUndefined();
    expect(old.state.closed).toBe(true);
    expect(s.mesh).toBe(joined.mesh);
    expect(joined.employees).toEqual(["Lee"]);
    expect(s.isolated).toBe(false);
    expect(s.screen).toBe("scan");
  });

  it("re-pair that cannot save the clerk name is fatal and drops the joined mesh", async () => {
    const s = await started();
    const sessionId = s.meta!.sessionId;
    db.failSetEmployee(true);
    const joined = fakeMesh();
    await s.adoptJoinedSession(offerFor(sessionId), "Lee", joined.mesh);
    expect(s.fatal).toMatch(/^Could not save the clerk's name/);
    expect(joined.state.closed).toBe(true);
    expect(s.mesh).toBe(db.meshes[0]!.mesh);
  });

  it("a failed join-open closes the joined mesh", async () => {
    db.lockAvailable(false);
    const s = useSession();
    const joined = fakeMesh();
    await s.adoptJoinedSession(offerFor("joined-1"), "Lee", joined.mesh);
    expect(s.fatal).not.toBeNull();
    expect(joined.state.closed).toBe(true);
    expect(s.mesh).toBeNull();
  });

  it("readOffer accepts any session's join code until a session is open, then only its own", async () => {
    const s = useSession();
    expect(s.readOffer(code("offer", "other")).sessionName).toBe("Outage");
    expect(() => s.readOffer(code("answer", "other"))).toThrow(
      expect.objectContaining({ code: "wrong-kind" }),
    );
    expect(() => s.readOffer("hello")).toThrow(expect.objectContaining({ code: "malformed" }));

    await s.startSession("Mine", "Rae");
    const own = s.meta!.sessionId;
    expect(s.readOffer(code("offer", own)).sessionId).toBe(own);
    expect(() => s.readOffer(code("offer", "other"))).toThrow(
      expect.objectContaining({ code: "wrong-session" }),
    );
  });

  it("joinSession answers as this device and the given clerk, checking the session first", async () => {
    const calls: unknown[][] = [];
    const joinMesh = (async (...args: unknown[]) => {
      calls.push(args);
      return "joined";
    }) as unknown as typeof db.deps.joinMesh;
    setSessionDeps({ ...db.deps, joinMesh, getDeviceId: async () => "dev-new" });
    setActivePinia(createPinia());
    const s = useSession();
    const text = code("offer", "joined-1");
    expect(await s.joinSession(text, " Lee ")).toBe("joined");
    expect(calls[0]![0]).toBe(text);
    expect(calls[0]![1]).toMatchObject({ deviceId: "dev-new", employee: "Lee" });

    await s.startSession("Mine", "Rae");
    await expect(s.joinSession(text, "Lee")).rejects.toMatchObject({ code: "wrong-session" });
    const own = code("offer", s.meta!.sessionId);
    await s.joinSession(own, "Rae");
    expect(calls[1]![1]).toMatchObject({ deviceId: DEVICE, employee: "Rae" });
    expect(calls).toHaveLength(2);
  });
});

describe("useSession disconnected notice", () => {
  it("is off for a brand-new session that has only ever been on this machine", async () => {
    const s = await started();
    expect(s.isolated).toBe(true);
    expect(s.disconnected).toBe(false);
  });

  it("is on when the session has records from other workstations but no peer is connected", async () => {
    const s = await started();
    const sessionId = s.meta!.sessionId;
    db.logs.get(sessionId)!.push(remoteRecord(sessionId));
    const r = reload();
    await r.resumeSession(sessionId);
    expect(r.disconnected).toBe(true);
    db.meshes.at(-1)!.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    expect(r.disconnected).toBe(false);
  });

  it("is on once a peer seen in this page load drops, even before any of its records arrive", async () => {
    const s = await started();
    const m = db.meshes[0]!;
    m.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    expect(s.disconnected).toBe(false);
    m.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: false }]);
    expect(s.disconnected).toBe(true);
  });

  it("starts over when another session is opened", async () => {
    const s = await started();
    db.meshes[0]!.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: false }]);
    db.meshes[0]!.setPeers([{ deviceId: "dev-b", employee: "Sam", connected: true }]);
    await s.startSession("Second", "Rae");
    expect(s.disconnected).toBe(false);
  });
});

describe("useSession ensureMesh", () => {
  it("tells the clerk when the mesh cannot be created and retries on the next call", async () => {
    let fail = true;
    const createMesh = db.deps.createMesh;
    setSessionDeps({
      ...db.deps,
      createMesh(o) {
        if (fail) throw new Error("RTCPeerConnection is not defined");
        return createMesh(o);
      },
    });
    setActivePinia(createPinia());
    const s = useSession();
    await s.startSession("X", "Rae");
    expect(s.screen).toBe("scan");
    expect(s.mesh).toBeNull();
    expect(s.message?.tone).toBe("error");
    expect(s.message?.text).toMatch(/^Could not start networking on this workstation/);

    expect(s.ensureMesh()).toBeNull();
    fail = false;
    const m = s.ensureMesh();
    expect(m).toBe(db.meshes[0]!.mesh);
    expect(s.mesh).toBe(m);
    expect(s.ensureMesh()).toBe(m);
    expect(db.meshes).toHaveLength(1);
  });

  it("adoptJoinedSession reports whether the session was opened", async () => {
    const s = useSession();
    expect(await s.adoptJoinedSession(offerFor("joined-1"), "Lee", fakeMesh().mesh)).toBe(true);
    db.lockAvailable(false);
    const t = reload();
    expect(await t.adoptJoinedSession(offerFor("joined-2"), "Lee", fakeMesh().mesh)).toBe(false);
  });
});
