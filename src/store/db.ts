import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { randomId } from "../log/ids";
import type { LogRecord, RecordBody, VersionVector } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";

export interface SessionMeta {
  sessionId: string;
  name: string;
  deviceId: string;
  employee: string;
  nextSeq: number;
  createdAt: number;
}

export interface SessionSummary {
  sessionId: string;
  name: string;
  employee: string;
  createdAt: number;
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
    },
    async append(body) {
      const tx = db.transaction(["records", "meta"], "readwrite");
      try {
        const m = await tx.objectStore("meta").get(META_KEY);
        if (!m) throw new Error(`Session ${sessionId} has no metadata`);
        const record = {
          sessionId,
          deviceId: m.deviceId,
          seq: m.nextSeq,
          employee: m.employee,
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
      const tx = db.transaction(["records", "meta"], "readwrite");
      const store = tx.objectStore("records");
      const own = (await tx.objectStore("meta").get(META_KEY))?.deviceId;
      const stored: LogRecord[] = [];
      for (const r of records) {
        // Only append() writes this machine's records; a peer's copy would collide with it.
        if (r.sessionId !== sessionId || r.deviceId === own) continue;
        if ((await store.get([r.deviceId, r.seq])) !== undefined) continue;
        await store.add(r);
        stored.push(r);
      }
      await tx.done;
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
  return makeStore(sessionId, await openSessionDb(sessionId));
}

export async function listSessions(): Promise<SessionSummary[]> {
  const index = await openIndex();
  try {
    const all = await index.getAll("sessions");
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    index.close();
  }
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
