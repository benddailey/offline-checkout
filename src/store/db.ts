import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { randomId, recordId } from "../log/ids";
import type { LogRecord, RecordBody, RecordId, VersionVector } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";

export interface SessionMeta {
  sessionId: string;
  name: string;
  deviceId: string;
  employee: string;
  /** This workstation's name, copied in when the session is created or opened. */
  workstation?: string;
  nextSeq: number;
  createdAt: number;
}

export interface SessionSummary {
  sessionId: string;
  name: string;
  employee: string;
  createdAt: number;
  /** When the session was first closed, on any workstation. */
  closedAt?: number;
  /** Open sessions only: the latest record time from any workstation, or createdAt. Not stored. */
  lastActivityAt?: number;
  /** Open sessions only: each other workstation's latest record, if it has a name. Not stored. */
  workstations?: SeenWorkstation[];
}

export interface SeenWorkstation {
  deviceId: string;
  name: string;
  lastAt: number;
}

export interface SessionStore {
  readonly sessionId: string;
  meta(): Promise<SessionMeta>;
  setEmployee(name: string): Promise<void>;
  /** One readwrite tx over [records, meta]: seq = nextSeq, nextSeq++. Rejects on failure. */
  append(body: RecordBody): Promise<LogRecord>;
  /** Ignores existing keys, foreign sessionId and this machine's deviceId; returns newly stored records. */
  put(records: LogRecord[]): Promise<LogRecord[]>;
  all(): Promise<LogRecord[]>;
  since(theirs: VersionVector): Promise<LogRecord[]>;
  vector(): Promise<VersionVector>;
  close(): void;
}

interface IndexSchema extends DBSchema {
  device: { key: string; value: string };
  sessions: { key: string; value: SessionSummary };
}

interface SessionSchema extends DBSchema {
  records: { key: [string, number]; value: LogRecord };
  meta: { key: string; value: SessionMeta };
}

const INDEX_DB = "offline-checkout";
/** Records are flushed to disk before the write resolves: a scan on screen survives power loss. */
const STRICT: IDBTransactionOptions = { durability: "strict" };
const META_KEY = "meta";

function openIndex(): Promise<IDBPDatabase<IndexSchema>> {
  return openDB<IndexSchema>(INDEX_DB, 1, {
    upgrade(db) {
      db.createObjectStore("device");
      db.createObjectStore("sessions", { keyPath: "sessionId" });
    },
  });
}

function openSessionDb(sessionId: string): Promise<IDBPDatabase<SessionSchema>> {
  return openDB<SessionSchema>(`oc-session-${sessionId}`, 1, {
    upgrade(db) {
      db.createObjectStore("records", { keyPath: ["deviceId", "seq"] });
      db.createObjectStore("meta");
    },
  });
}

export async function getDeviceId(): Promise<string> {
  const db = await openIndex();
  try {
    const tx = db.transaction("device", "readwrite");
    let id = await tx.store.get("id");
    if (id === undefined) {
      id = randomId(10);
      await tx.store.put(id, "id");
    }
    await tx.done;
    return id;
  } finally {
    db.close();
  }
}

const WORKSTATION_KEY = "name";

/** The name staff gave this workstation (this browser profile), if any. */
export async function getWorkstationName(): Promise<string | undefined> {
  const db = await openIndex();
  try {
    return await db.get("device", WORKSTATION_KEY);
  } finally {
    db.close();
  }
}

export async function setWorkstationName(name: string): Promise<void> {
  const db = await openIndex();
  try {
    await db.put("device", name, WORKSTATION_KEY);
  } finally {
    db.close();
  }
}

/** Copy the workstation name into the session's meta, so append() stamps it without a lookup. */
async function adoptWorkstation(
  db: IDBPDatabase<SessionSchema>,
  workstation: string | undefined,
): Promise<void> {
  const tx = db.transaction("meta", "readwrite");
  const m = await tx.store.get(META_KEY);
  if (m && workstation !== undefined && m.workstation !== workstation) {
    await tx.store.put({ ...m, workstation }, META_KEY);
  }
  await tx.done;
}

function makeStore(sessionId: string, db: IDBPDatabase<SessionSchema>): SessionStore {
  const readMeta = async (): Promise<SessionMeta> => {
    const m = await db.get("meta", META_KEY);
    if (!m) throw new Error(`Session ${sessionId} has no metadata`);
    return m;
  };
  return {
    sessionId,
    meta: readMeta,
    async setEmployee(name) {
      const tx = db.transaction("meta", "readwrite");
      const m = await tx.store.get(META_KEY);
      if (!m) throw new Error(`Session ${sessionId} has no metadata`);
      await tx.store.put({ ...m, employee: name }, META_KEY);
      await tx.done;
      const index = await openIndex();
      try {
        const summary = await index.get("sessions", sessionId);
        if (summary) await index.put("sessions", { ...summary, employee: name });
      } finally {
        index.close();
      }
    },
    async append(body) {
      const tx = db.transaction(["records", "meta"], "readwrite", STRICT);
      try {
        const m = await tx.objectStore("meta").get(META_KEY);
        if (!m) throw new Error(`Session ${sessionId} has no metadata`);
        const record = {
          sessionId,
          deviceId: m.deviceId,
          seq: m.nextSeq,
          employee: m.employee,
          ...(m.workstation === undefined ? {} : { workstation: m.workstation }),
          at: Date.now(),
          ...body,
        } as LogRecord;
        await tx.objectStore("records").add(record);
        await tx.objectStore("meta").put({ ...m, nextSeq: m.nextSeq + 1 }, META_KEY);
        await tx.done;
        return record;
      } catch (e) {
        try {
          tx.abort();
        } catch {
          // already finished or aborted
        }
        tx.done.catch(() => {});
        throw e;
      }
    },
    async put(records) {
      const tx = db.transaction(["records", "meta"], "readwrite", STRICT);
      const store = tx.objectStore("records");
      const own = (await tx.objectStore("meta").get(META_KEY))?.deviceId;
      const candidates = new Map<RecordId, LogRecord>();
      for (const r of records) {
        // Only append() writes this machine's records; a peer's copy would collide with it.
        if (r.sessionId !== sessionId || r.deviceId === own) continue;
        if (!candidates.has(recordId(r))) candidates.set(recordId(r), r);
      }
      // Queue every request before awaiting: a round trip per record is slow on a slow CPU.
      const fresh = [...candidates.values()];
      const found = await Promise.all(fresh.map((r) => store.getKey([r.deviceId, r.seq])));
      const stored = fresh.filter((_, i) => found[i] === undefined);
      await Promise.all([...stored.map((r) => store.add(r)), tx.done]);
      return stored;
    },
    all: () => db.getAll("records"),
    async since(theirs) {
      return missingFor(await db.getAll("records"), theirs);
    },
    async vector() {
      return vectorOf(await db.getAll("records"));
    },
    close() {
      db.close();
    },
  };
}

export async function createSession(o: {
  sessionId?: string;
  name: string;
  employee: string;
  withCreatedRecord: boolean;
}): Promise<SessionStore> {
  const sessionId = o.sessionId ?? randomId(10);
  const deviceId = await getDeviceId();
  const db = await openSessionDb(sessionId);
  const store = makeStore(sessionId, db);
  const createdAt = Date.now();
  const existing = await db.get("meta", META_KEY);
  if (!existing) {
    await db.put(
      "meta",
      { sessionId, name: o.name, deviceId, employee: o.employee, nextSeq: 1, createdAt },
      META_KEY,
    );
  }
  await adoptWorkstation(db, await getWorkstationName());
  if (!existing) {
    if (o.withCreatedRecord) await store.append({ type: "session-created", name: o.name });
  }
  const index = await openIndex();
  try {
    await index.put("sessions", {
      sessionId,
      name: existing?.name ?? o.name,
      employee: existing?.employee ?? o.employee,
      createdAt: existing?.createdAt ?? createdAt,
    });
  } finally {
    index.close();
  }
  return store;
}

export async function openSessionStore(sessionId: string): Promise<SessionStore> {
  const index = await openIndex();
  let known: SessionSummary | undefined;
  try {
    known = await index.get("sessions", sessionId);
  } finally {
    index.close();
  }
  if (!known) throw new Error(`Unknown session ${sessionId}`);
  const db = await openSessionDb(sessionId);
  await adoptWorkstation(db, await getWorkstationName());
  return makeStore(sessionId, db);
}

async function readLog(
  sessionId: string,
): Promise<{ closedAt?: number; lastAt?: number; workstations: SeenWorkstation[] }> {
  const db = await openSessionDb(sessionId);
  try {
    const own = (await db.get("meta", META_KEY))?.deviceId;
    let closedAt: number | undefined;
    let lastAt: number | undefined;
    const latest = new Map<string, LogRecord>();
    for (const r of await db.getAll("records")) {
      if (r.type === "session-closed" && (closedAt === undefined || r.at < closedAt)) {
        closedAt = r.at;
      }
      if (lastAt === undefined || r.at > lastAt) lastAt = r.at;
      // By seq, not by clock: a PC's clock can go back.
      const prev = latest.get(r.deviceId);
      if (r.deviceId !== own && (!prev || r.seq > prev.seq)) latest.set(r.deviceId, r);
    }
    const workstations = [...latest.values()].flatMap((r) =>
      r.workstation ? [{ deviceId: r.deviceId, name: r.workstation, lastAt: r.at }] : [],
    );
    return { closedAt, lastAt, workstations };
  } finally {
    db.close();
  }
}

/**
 * A close time, once found, is saved in the index, so only sessions not yet seen closed are read.
 * Reading the log covers closes made before the index had the field and closes from peers.
 */
export async function listSessions(): Promise<SessionSummary[]> {
  const index = await openIndex();
  try {
    const all = await index.getAll("sessions");
    for (const s of all) {
      if (s.closedAt !== undefined) continue;
      const { closedAt, lastAt, workstations } = await readLog(s.sessionId);
      if (closedAt === undefined) {
        s.lastActivityAt = Math.max(s.createdAt, lastAt ?? 0);
        s.workstations = workstations;
        continue;
      }
      s.closedAt = closedAt;
      await index.put("sessions", s);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    index.close();
  }
}

/** The index entry goes first, so a concurrent listSessions never re-opens (and re-creates) the log. */
export async function deleteSession(sessionId: string): Promise<void> {
  const index = await openIndex();
  try {
    await index.delete("sessions", sessionId);
  } finally {
    index.close();
  }
  await deleteDB(`oc-session-${sessionId}`);
}

export function acquireSessionLock(sessionId: string): Promise<null | (() => void)> {
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(`oc-session-${sessionId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch(reject);
  });
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
