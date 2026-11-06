import { defineStore } from "pinia";
import { computed, nextTick, ref, shallowRef } from "vue";
import { CONTROL, normalizeScan, validateBarcode } from "../log/barcode";
import { MAX_NAME, clampName } from "../log/limits";
import { checkItem } from "../log/duplicates";
import { planImport, type ImportPlan, type ImportSource } from "../import/plan";
import { readImportFiles } from "../import/read";
import type { FileRejection, FileSource } from "../import/rows";
import { sessionSource, type SessionSource } from "../import/session";
import { randomId, recordId } from "../log/ids";
import { reduce } from "../log/reduce";
import { isLogRecord } from "../log/validate";
import type {
  ExportKind,
  ItemState,
  LogRecord,
  RecordBody,
  RecordId,
  VisitState,
} from "../log/types";
import { Mesh, type MeshOptions, type PeerInfo } from "../mesh/mesh";
import { isPairingText } from "../pairing/chunks";
import { PairingError, decodePayload, type PairingPayload } from "../pairing/payload";
import { downloadBlob, renderScannerCard, renderSessionPdf } from "../pdf/render";
import { buildCsv } from "../export/csv";
import { exportRows } from "../export/rows";
import { buildXacts } from "../export/xacts";
import { buildXlsx } from "../export/xlsx";
import { afterPaint } from "../print/print";
import { visitReceipt, type VisitReceipt } from "../print/receipt";
import { printScannerCardReceipt } from "../print/scanner-card";
import { printVisitReceipt } from "../print/visit-receipt";
import * as db from "../store/db";
import type { SessionMeta, SessionStore, SessionSummary } from "../store/db";
import { SyncEngine } from "../sync/sync";

export type Screen = "launch" | "pair-invite" | "pair-join" | "scan" | "summary";
export type Message = { tone: "info" | "warn" | "error"; text: string };

export interface SessionDeps {
  createSession: typeof db.createSession;
  openSessionStore: typeof db.openSessionStore;
  listSessions: typeof db.listSessions;
  readRecords: typeof db.readRecords;
  deleteSession: typeof db.deleteSession;
  acquireSessionLock: typeof db.acquireSessionLock;
  requestPersistence: typeof db.requestPersistence;
  renderSessionPdf: typeof renderSessionPdf;
  renderScannerCard: typeof renderScannerCard;
  downloadBlob: typeof downloadBlob;
  getDeviceId: typeof db.getDeviceId;
  getWorkstationName: typeof db.getWorkstationName;
  setWorkstationName: typeof db.setWorkstationName;
  /** The live mesh for a session opened here (start or resume). */
  createMesh: (o: MeshOptions) => Mesh;
  /** Answer a pairing offer (Mesh.join). */
  joinMesh: typeof Mesh.join;
  /** Wall clock for default session names, PDF dates and receipts. */
  now: () => Date;
  /** Resolves once the browser has painted the current DOM. */
  afterPaint: () => Promise<void>;
  /** Open the print dialog with a visit receipt. */
  printVisitReceipt: (r: VisitReceipt) => void;
  /** Open the print dialog with the scanner card as a receipt. */
  printScannerCardReceipt: () => void;
}

/** Real dependencies, with any of them replaced (tests pass an in-memory store and a fixed clock). */
export function createSessionStoreDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    createSession: db.createSession,
    openSessionStore: db.openSessionStore,
    listSessions: db.listSessions,
    readRecords: db.readRecords,
    deleteSession: db.deleteSession,
    acquireSessionLock: db.acquireSessionLock,
    requestPersistence: db.requestPersistence,
    renderSessionPdf,
    renderScannerCard,
    downloadBlob,
    getDeviceId: db.getDeviceId,
    getWorkstationName: db.getWorkstationName,
    setWorkstationName: db.setWorkstationName,
    createMesh: (o) => new Mesh(o),
    joinMesh: (text, o) => Mesh.join(text, o),
    now: () => new Date(),
    afterPaint,
    printVisitReceipt,
    printScannerCardReceipt,
    ...overrides,
  };
}

let activeDeps = createSessionStoreDeps();

/** Deps used by stores created after this call. */
export function setSessionDeps(deps: SessionDeps): void {
  activeDeps = deps;
}

/** How long deleteSession waits for connected workstations to confirm. */
export const DELETE_REPLY_MS = 3_000;
/** How long a deleted workstation keeps its mesh open for its `deleted` reply to get out. */
export const DELETED_LINGER_MS = 1_000;

type DeleteMessage = { t: "delete-session"; workstation: string } | { t: "deleted" };

export const LOCKED_MESSAGE = "This session is already open in another tab";
const MESH_FAILED = "Could not start networking on this workstation";

/** Local date as YYYY-MM-DD. */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}

function saveFailed(what: "scan" | "change", err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return (
    `Could not save the ${what} — this computer's browser storage refused it (${reason}). ` +
    "Do not continue scanning on this workstation."
  );
}

export const useSession = defineStore("session", () => {
  const deps = activeDeps;

  const screen = ref<Screen>("launch");
  const meta = ref<SessionMeta | null>(null);
  const records = shallowRef<LogRecord[]>([]);
  const currentVisitId = ref<RecordId | null>(null);
  const message = ref<Message | null>(null);
  const fatal = ref<string | null>(null);
  /** A calm, dismissable notice shown on Launch (e.g. the session is open in another tab). */
  const notice = ref<string | null>(null);
  const peers = ref<PeerInfo[]>([]);
  const isolated = ref(true);
  /** A peer has been connected since this session was opened in this page. */
  const hadPeer = ref(false);
  const mesh = shallowRef<Mesh | null>(null);
  /** Set after "Start new session" so the scan screen can offer the scanner card. */
  const offerScannerCard = ref(false);
  /** A status bar dialog is open: the scanner input stands down. */
  const toolbarDialog = ref(false);
  /** This workstation's saved name: undefined until loaded, null if it has none yet. */
  const workstationName = ref<string | null | undefined>(undefined);

  const state = computed(() => reduce(records.value));
  /**
   * Cut off from a session that has other workstations: after a reload, crash or sleep, or a
   * lost link. A brand-new session that has only ever been on this machine is not "disconnected".
   */
  const disconnected = computed(() => {
    if (!isolated.value || !meta.value) return false;
    const own = meta.value.deviceId;
    return hadPeer.value || records.value.some((r) => r.deviceId !== own && !r.imported);
  });
  const closed = computed(() => state.value.closed);
  /**
   * Other workstations in this session's log that are not connected now: their latest scans may
   * be missing here. Named by the clerk on each one's latest (highest seq) record.
   */
  const notConnected = computed<{ deviceId: string; employee: string; workstation: string }[]>(
    () => {
      const own = meta.value?.deviceId;
      const connected = new Set(peers.value.filter((p) => p.connected).map((p) => p.deviceId));
      const latest = new Map<string, LogRecord>();
      for (const r of records.value) {
        if (r.deviceId === own || r.imported || connected.has(r.deviceId)) continue;
        const prev = latest.get(r.deviceId);
        if (!prev || r.seq > prev.seq) latest.set(r.deviceId, r);
      }
      const out = new Map<string, { employee: string; workstation: string }>();
      for (const r of latest.values()) {
        out.set(r.deviceId, { employee: r.employee, workstation: r.workstation ?? "" });
      }
      // Peers seen this page load that dropped, even if none of their records have arrived.
      for (const p of peers.value) {
        if (!p.connected && p.deviceId !== own && !out.has(p.deviceId)) {
          out.set(p.deviceId, { employee: p.employee, workstation: "" });
        }
      }
      return [...out]
        .map(([deviceId, d]) => ({ deviceId, ...d }))
        .sort((a, b) => a.employee.localeCompare(b.employee) || (a.deviceId < b.deviceId ? -1 : 1));
    },
  );
  const currentVisit = computed<VisitState | null>(() => {
    const id = currentVisitId.value;
    if (id === null) return null;
    const v = state.value.visits.find((x) => x.id === id);
    return v && !v.ended && !v.voided ? v : null;
  });

  /**
   * This workstation's open patron: leaving the scan screen is blocked until it is ended or
   * voided, so a later scan is never filed under it by mistake. Lifted once the session closes,
   * since the patron can no longer be ended then.
   */
  const lockedPatron = computed(() =>
    currentVisit.value && !closed.value ? currentVisit.value.patron : null,
  );
  /** Patrons still open on other workstations, named by the clerk who started each. */
  const othersInProgress = computed<{ employee: string; patron: string }[]>(() => {
    const own = meta.value?.deviceId;
    return state.value.visits
      .filter((v) => v.deviceId !== own && !v.imported && !v.ended && !v.voided)
      .map((v) => ({ employee: v.employee, patron: v.patron }));
  });

  let store: SessionStore | null = null;
  let releaseLock: (() => void) | null = null;
  let sync: SyncEngine | null = null;
  let unsubPeers: (() => void) | null = null;
  let unsubMessages: (() => void) | null = null;
  /** A delete under way here, started by this workstation or a peer; others are ignored. */
  const deleting = shallowRef<{ sessionId: string; by: "self" | "peer" } | null>(null);
  const deletingSession = computed(() => deleting.value?.by === "self");
  /** While deleteSession waits: the peers yet to reply, and how to stop waiting. */
  let awaitingDeleted: { peers: Set<string>; done: () => void } | null = null;
  const known = new Set<RecordId>();
  /** Every scan and edit runs in arrival order, one append at a time. */
  let queue: Promise<void> = Promise.resolve();

  function merge(fresh: LogRecord[]): void {
    const add = fresh.filter((r) => {
      const id = recordId(r);
      if (known.has(id)) return false;
      known.add(id);
      return true;
    });
    if (add.length) records.value = records.value.concat(add);
  }

  function detachMesh(): void {
    sync?.stop();
    sync = null;
    unsubPeers?.();
    unsubPeers = null;
    unsubMessages?.();
    unsubMessages = null;
    mesh.value?.close();
    mesh.value = null;
    peers.value = [];
    isolated.value = true;
  }

  function teardown(): void {
    detachMesh();
    store?.close();
    store = null;
    releaseLock?.();
    releaseLock = null;
    known.clear();
    records.value = [];
    meta.value = null;
    currentVisitId.value = null;
    message.value = null;
    notice.value = null;
    offerScannerCard.value = false;
    toolbarDialog.value = false;
    hadPeer.value = false;
  }

  /** Release the session here (lock, store, mesh) and go back to Launch. */
  function leaveSession(): void {
    if (deletingSession.value) return;
    teardown();
    screen.value = "launch";
  }

  let opening = 0;

  /**
   * Lock, load and show the session; on a held lock sets `notice`, on failure sets `fatal`, and returns false.
   * Also returns false, releasing what it took, if a later call has started meanwhile.
   */
  async function open(
    sessionId: string,
    openStore: () => Promise<SessionStore>,
    employee?: string,
  ): Promise<boolean> {
    teardown();
    const gen = ++opening;
    let release: (() => void) | null = null;
    let opened: SessionStore | null = null;
    try {
      release = await deps.acquireSessionLock(sessionId);
      if (gen !== opening) {
        release?.();
        return false;
      }
      if (!release) {
        notice.value = LOCKED_MESSAGE;
        screen.value = "launch";
        return false;
      }
      opened = await openStore();
      if (employee !== undefined && (await opened.meta()).employee !== employee) {
        await opened.setEmployee(employee);
      }
      const m = await opened.meta();
      const recs = await opened.all();
      if (gen !== opening) {
        opened.close();
        release();
        return false;
      }
      store = opened;
      releaseLock = release;
      meta.value = m;
      merge(recs);
      void deps.requestPersistence();
      return true;
    } catch (err) {
      opened?.close();
      release?.();
      if (gen !== opening) return false;
      console.error("session: could not open", err);
      fatal.value = `Could not open the session: ${err instanceof Error ? err.message : String(err)}`;
      teardown();
      return false;
    }
  }

  async function startSession(name: string, employee: string): Promise<void> {
    const sessionName = clampName(name) || ymd(deps.now());
    const clerk = clampName(employee);
    if (!clerk) {
      message.value = { tone: "error", text: "Enter the clerk's name" };
      return;
    }
    teardown();
    let created: SessionStore;
    try {
      created = await deps.createSession({
        name: sessionName,
        employee: clerk,
        withCreatedRecord: true,
      });
    } catch (err) {
      console.error("session: could not create", err);
      fatal.value = `Could not create the session: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    let taken = false;
    const ok = await open(created.sessionId, async () => {
      taken = true;
      return created;
    });
    if (!ok) {
      // Once open() has taken the store, its own teardown closes it.
      if (!taken) created.close();
      return;
    }
    ensureMesh();
    offerScannerCard.value = true;
    screen.value = "scan";
  }

  /** An open session needs the clerk's name; a closed one opens on its summary without one. */
  async function resumeSession(sessionId: string, employee?: string): Promise<void> {
    const clerk = employee === undefined ? undefined : clampName(employee);
    if (clerk === "") {
      message.value = { tone: "error", text: "Enter the clerk's name" };
      return;
    }
    if (!(await open(sessionId, () => deps.openSessionStore(sessionId), clerk))) return;
    ensureMesh();
    const own = meta.value!.deviceId;
    let latest: VisitState | null = null;
    for (const v of state.value.visits) {
      if (v.deviceId !== own || v.ended || v.voided) continue;
      if (!latest || seqOf(v.id) > seqOf(latest.id)) latest = v;
    }
    currentVisitId.value = latest?.id ?? null;
    screen.value = closed.value ? "summary" : "scan";
  }

  /** Later scans here are recorded under `employee`; returns false if the name is blank or not saved. */
  async function changeClerk(employee: string): Promise<boolean> {
    const clerk = clampName(employee);
    if (!clerk) return false;
    let saved = false;
    await enqueue(async () => {
      if (!store) return;
      try {
        await store.setEmployee(clerk);
        meta.value = await store.meta();
        mesh.value?.setEmployee(clerk);
        saved = true;
      } catch (err) {
        console.error("session: could not save the clerk name", err);
        fatal.value = `Could not save the clerk's name: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
    return saved;
  }

  async function adoptJoinedSession(
    offer: PairingPayload,
    employee: string,
    joined: Mesh,
  ): Promise<boolean> {
    const clerk = clampName(employee);
    if (store?.sessionId === offer.sessionId) {
      // Re-pair of the session already open here: keep store and lock, swap the mesh.
      if (meta.value?.employee !== clerk) {
        try {
          await store.setEmployee(clerk);
          meta.value = await store.meta();
        } catch (err) {
          console.error("session: could not save the clerk name", err);
          fatal.value = `Could not save the clerk's name: ${err instanceof Error ? err.message : String(err)}`;
          joined.close();
          return false;
        }
      }
    } else {
      const ok = await open(
        offer.sessionId,
        () =>
          deps.createSession({
            sessionId: offer.sessionId,
            name: clampName(offer.sessionName),
            employee: clerk,
            withCreatedRecord: false,
          }),
        clerk,
      );
      if (!ok) {
        joined.close();
        return false;
      }
    }
    attachMesh(joined);
    screen.value = "scan";
    return true;
  }

  function attachMesh(m: Mesh): void {
    if (!store) throw new Error("attachMesh needs an open session");
    if (mesh.value !== m) detachMesh();
    else {
      sync?.stop();
      unsubPeers?.();
      unsubMessages?.();
    }
    mesh.value = m;
    const setPeers = (list: PeerInfo[]) => {
      peers.value = list;
      isolated.value = !list.some((p) => p.connected);
      if (!isolated.value) hadPeer.value = true;
    };
    unsubPeers = m.onPeerChange(setPeers);
    unsubMessages = m.onMessage(onDeleteMessage);
    setPeers(m.peers());
    if (meta.value) m.setEmployee(meta.value.employee);
    sync = new SyncEngine({
      mesh: m,
      store,
      onRecords: (fresh) => {
        try {
          merge(fresh);
        } catch (err) {
          console.error("session: could not merge synced records", err);
        }
      },
    });
    sync.start();
  }

  /**
   * The open session's mesh, creating one if it has none, so Add workstation always has one to
   * invite from. On failure tells the clerk and returns null (Add workstation retries).
   */
  function ensureMesh(): Mesh | null {
    const m = meta.value;
    if (!m) return null;
    if (mesh.value) return mesh.value;
    try {
      attachMesh(
        deps.createMesh({
          sessionId: m.sessionId,
          sessionName: m.name,
          deviceId: m.deviceId,
          employee: m.employee,
          knownDevices,
        }),
      );
      if (message.value?.text.startsWith(MESH_FAILED)) message.value = null;
      return mesh.value;
    } catch (err) {
      console.error("session: could not start the mesh", err);
      message.value = {
        tone: "error",
        text: `${MESH_FAILED} (${err instanceof Error ? err.message : String(err)}). Scanning still works; other workstations cannot connect yet.`,
      };
      return null;
    }
  }

  /**
   * Decode a scanned join code. While a session is open here (re-pair) only that session's
   * codes are accepted. Throws PairingError.
   */
  function readOffer(text: string): PairingPayload {
    const offer = decodePayload(text, "offer");
    if (meta.value && offer.sessionId !== meta.value.sessionId) {
      throw new PairingError("wrong-session", "That code is for a different session.");
    }
    return offer;
  }

  /** Answer a join code as `employee`; the caller shows the answer and waits for `connected`. */
  async function joinSession(offerText: string, employee: string) {
    readOffer(offerText);
    const deviceId = meta.value?.deviceId ?? (await deps.getDeviceId());
    return deps.joinMesh(offerText, { deviceId, employee: clampName(employee), knownDevices });
  }

  function knownDevices(): Set<string> {
    return new Set(records.value.filter((r) => !r.imported).map((r) => r.deviceId));
  }

  /** Append one record; it joins `records` only once committed. */
  async function commit(body: RecordBody, what: "scan" | "change"): Promise<LogRecord | null> {
    const target = store;
    if (!target) return null;
    try {
      const r = await target.append(body);
      // The session was switched while this append was in flight: it belongs to the old one.
      if (store !== target) return null;
      merge([r]);
      sync?.pushLocal(r);
      return r;
    } catch (err) {
      console.error("session: append failed", err);
      if (store !== target) return null;
      fatal.value = saveFailed(what, err);
      return null;
    }
  }

  /** Run `task` after every earlier scan/edit; never rejects. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    // A task queued for one session never runs against the next one opened here.
    const owner = store;
    const run = queue.then(async () => {
      if (fatal.value !== null || !store || store !== owner) return;
      try {
        await task();
      } catch (err) {
        console.error("session: action failed", err);
        message.value = { tone: "error", text: "Something went wrong — try again" };
      }
    });
    queue = run;
    return run;
  }

  /**
   * Only after the patron-ended record is saved and the cleared screen has painted:
   * window.print() blocks scripts and rendering while the dialog is open.
   */
  async function printReceipt(visitId: RecordId): Promise<void> {
    const owner = store;
    try {
      const r = visitReceipt(state.value, visitId, deps.now());
      if (!r) return;
      await nextTick();
      await deps.afterPaint();
      if (store !== owner) return;
      deps.printVisitReceipt(r);
    } catch (err) {
      console.error("session: receipt failed", err);
      message.value = { tone: "error", text: "Could not print the receipt" };
    }
  }

  function scan(raw: string): Promise<void> {
    return enqueue(() => processScan(raw));
  }

  async function processScan(raw: string): Promise<void> {
    const code = normalizeScan(raw);
    if (code === "") return;
    if (isPairingText(raw)) {
      message.value = {
        tone: "error",
        text: "That is a pairing barcode. Scan it on the Add workstation or Join session screen.",
      };
      return;
    }
    if (closed.value) {
      message.value = { tone: "error", text: "Session closed" };
      return;
    }
    const visit = currentVisit.value;
    if (code === CONTROL.END) {
      if (!visit) {
        message.value = { tone: "info", text: "No patron in progress" };
        return;
      }
      if (await commit({ type: "patron-ended", visitId: visit.id }, "scan")) {
        currentVisitId.value = null;
        message.value = null;
        await printReceipt(visit.id);
      }
      return;
    }
    if (code === CONTROL.VOIDLAST) {
      // The last item this workstation scanned: seq order, never `at` (the clock can step back).
      const own = meta.value?.deviceId;
      let last: ItemState | undefined;
      for (const i of visit?.items ?? []) {
        if (i.voided || deviceOf(i.id) !== own) continue;
        if (!last || seqOf(i.id) > seqOf(last.id)) last = i;
      }
      if (!last) {
        message.value = { tone: "info", text: "Nothing to void" };
        return;
      }
      if (await commit({ type: "voided", target: last.id }, "scan")) {
        message.value = { tone: "info", text: `Voided ${last.barcode}` };
      }
      return;
    }
    const valid = validateBarcode(code);
    if (!valid.ok) {
      message.value = { tone: "error", text: `Not accepted: ${valid.reason}` };
      return;
    }
    if (!visit) {
      const r = await commit({ type: "patron-started", patron: code }, "scan");
      if (r) {
        currentVisitId.value = recordId(r);
        message.value = null;
        offerScannerCard.value = false;
      }
      return;
    }
    const dup = checkItem(state.value, visit.id, code);
    if (dup.kind === "dup-this-patron") {
      message.value = { tone: "warn", text: "Already on this patron — not added" };
      return;
    }
    const r = await commit({ type: "item-scanned", visitId: visit.id, item: code }, "scan");
    if (!r) return;
    message.value =
      dup.kind === "dup-other-patron"
        ? { tone: "warn", text: `Also on patron ${dup.patrons.join(", ")}` }
        : null;
  }

  function voidRecord(id: RecordId): Promise<void> {
    return enqueue(async () => {
      if (closed.value) {
        message.value = { tone: "error", text: "Session closed" };
        return;
      }
      await commit({ type: "voided", target: id }, "change");
    });
  }

  function endPatron(): Promise<void> {
    return enqueue(async () => {
      const visit = currentVisit.value;
      if (!visit) return;
      if (closed.value) {
        message.value = { tone: "error", text: "Session closed" };
        return;
      }
      if (await commit({ type: "patron-ended", visitId: visit.id }, "change")) {
        currentVisitId.value = null;
        message.value = null;
        await printReceipt(visit.id);
      }
    });
  }

  function voidPatron(): Promise<void> {
    return enqueue(async () => {
      const visit = currentVisit.value;
      if (!visit) return;
      if (closed.value) {
        message.value = { tone: "error", text: "Session closed" };
        return;
      }
      if (await commit({ type: "voided", target: visit.id }, "change")) {
        currentVisitId.value = null;
        message.value = { tone: "info", text: `Voided patron ${visit.patron}` };
      }
    });
  }

  function closeSession(): Promise<void> {
    return enqueue(async () => {
      if (closed.value) return;
      await commit({ type: "session-closed" }, "change");
    });
  }

  function recordExport(kind: ExportKind): void {
    void enqueue(async () => void (await commit({ type: "exported", kind }, "change")));
  }

  function generatePdf(): void {
    if (!meta.value || state.value.totals.patrons === 0) return;
    try {
      const date = deps.now();
      const blob = deps.renderSessionPdf(state.value, { date });
      deps.downloadBlob(blob, `offline-checkout-${fileSafe(meta.value.name)}-${ymd(date)}.pdf`);
      recordExport("pdf");
    } catch (err) {
      console.error("session: PDF failed", err);
      message.value = { tone: "error", text: "Could not create the PDF" };
    }
  }

  function exportTable(format: "csv" | "xlsx" | "xacts"): void {
    if (!meta.value || state.value.totals.patrons === 0) return;
    if (format === "xacts" && state.value.totals.items === 0) return;
    try {
      const date = deps.now();
      const rows = exportRows(state.value);
      const blob =
        format === "csv"
          ? new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })
          : format === "xacts"
            ? new Blob([buildXacts(rows)], { type: "text/plain;charset=utf-8" })
            : new Blob([buildXlsx(state.value, rows, date)], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              });
      deps.downloadBlob(
        blob,
        `offline-checkout-${fileSafe(meta.value.name)}-${ymd(date)}.${format}`,
      );
      recordExport(format);
    } catch (err) {
      console.error(`session: ${format} export failed`, err);
      const noun = { csv: "CSV", xlsx: "Excel", xacts: "Evergreen" }[format];
      message.value = { tone: "error", text: `Could not create the ${noun} file` };
    }
  }

  /** Letter downloads a PDF; a receipt waits for the screen to paint, as window.print() blocks it. */
  async function printScannerCard(format: "receipt" | "letter"): Promise<void> {
    try {
      if (format === "letter") {
        deps.downloadBlob(deps.renderScannerCard(), "offline-checkout-scanner-card.pdf");
        return;
      }
      await nextTick();
      await deps.afterPaint();
      deps.printScannerCardReceipt();
    } catch (err) {
      console.error("session: scanner card failed", err);
      message.value = { tone: "error", text: "Could not create the scanner card" };
    }
  }

  /** The workstation name on the device's latest record, else its clerk on the mesh. */
  function deskName(deviceId: string): string {
    let latest: LogRecord | undefined;
    for (const r of records.value) {
      if (r.deviceId === deviceId && (!latest || r.seq > latest.seq)) latest = r;
    }
    return (
      latest?.workstation || peers.value.find((p) => p.deviceId === deviceId)?.employee || "Unnamed"
    );
  }

  /**
   * Remove the session's data here, first tearing it down if it is still the open one.
   * True if it was the open one and is gone; on failure sets fatal.
   */
  async function removeHere(sessionId: string): Promise<boolean> {
    const current = meta.value?.sessionId === sessionId;
    if (current) {
      teardown();
      screen.value = "launch";
    }
    try {
      await deps.deleteSession(sessionId);
      return current;
    } catch (err) {
      console.error("session: could not delete", err);
      fatal.value = `Could not delete the session: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    }
  }

  /** Resolves once `peer` is no longer connected on `m`, or after `ms`. */
  function untilDisconnected(m: Mesh, peer: string, ms: number): Promise<void> {
    const gone = (list: PeerInfo[]) => !list.some((p) => p.deviceId === peer && p.connected);
    if (gone(m.peers())) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        unsub();
        resolve();
      };
      const timer = setTimeout(done, ms);
      const unsub = m.onPeerChange((list) => gone(list) && done());
    });
  }

  /**
   * Delete a closed session here and on the connected workstations. Waits up to DELETE_REPLY_MS
   * for their replies first, as closing the mesh at once could drop the message.
   */
  async function deleteSession(): Promise<void> {
    const m = meta.value;
    if (deleting.value || !m || !closed.value) return;
    deleting.value = { sessionId: m.sessionId, by: "self" };
    try {
      const waiting = new Set(peers.value.filter((p) => p.connected).map((p) => p.deviceId));
      if (waiting.size) {
        const msg: DeleteMessage = {
          t: "delete-session",
          workstation: workstationName.value ?? m.workstation ?? "",
        };
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => done(), DELETE_REPLY_MS);
          const done = () => {
            clearTimeout(timer);
            awaitingDeleted = null;
            resolve();
          };
          awaitingDeleted = { peers: waiting, done };
          for (const id of waiting) mesh.value?.send(id, msg);
        });
      }
      const unconfirmed = [...waiting].map(deskName);
      if (!(await removeHere(m.sessionId))) return;
      notice.value =
        `Session ‘${m.name}’ deleted.` +
        (unconfirmed.length ? ` Not confirmed on: ${unconfirmed.join(", ")}.` : "");
    } finally {
      deleting.value = null;
    }
  }

  function onDeleteMessage(peer: string, raw: unknown): void {
    const msg = raw as Partial<Record<string, unknown>> | null;
    if (typeof msg !== "object" || msg === null) return;
    if (msg.t === "deleted" && awaitingDeleted) {
      awaitingDeleted.peers.delete(peer);
      if (awaitingDeleted.peers.size === 0) awaitingDeleted.done();
    } else if (msg.t === "delete-session") {
      void deletedByPeer(peer, msg.workstation);
    }
  }

  /** Never removes a session that is still open here. */
  async function deletedByPeer(peer: string, workstation: unknown): Promise<void> {
    const m = meta.value;
    const reply: DeleteMessage = { t: "deleted" };
    if (deleting.value) {
      // Both workstations deleting the same session: confirm, but delete only once.
      if (deleting.value.by === "self" && deleting.value.sessionId === m?.sessionId) {
        mesh.value?.send(peer, reply);
      }
      return;
    }
    if (!m || !closed.value) return;
    deleting.value = { sessionId: m.sessionId, by: "peer" };
    try {
      const link = mesh.value;
      link?.send(peer, reply);
      if (link) await untilDisconnected(link, peer, DELETED_LINGER_MS);
      const from =
        typeof workstation === "string" && workstation !== "" && workstation.length <= MAX_NAME
          ? workstation
          : "another workstation";
      if (!(await removeHere(m.sessionId))) return;
      notice.value = `Session ‘${m.name}’ was deleted on ${from}.`;
    } finally {
      deleting.value = null;
    }
  }

  function listSessions(): Promise<SessionSummary[]> {
    return deps.listSessions();
  }

  async function otherSessions(): Promise<SessionSummary[]> {
    const all = await deps.listSessions();
    return all.filter((x) => x.sessionId !== meta.value?.sessionId);
  }

  async function loadSessionSource(summary: SessionSummary): Promise<SessionSource> {
    const target = meta.value?.sessionId;
    if (!target) throw new Error("No session is open");
    return sessionSource(summary, await deps.readRecords(summary.sessionId), target);
  }

  function readFiles(files: File[]): Promise<(FileSource | FileRejection)[]> {
    return readImportFiles(files, deps.now().getTime());
  }

  function planFor(sources: ImportSource[]): ImportPlan {
    return planImport(sources, records.value, {
      sessionId: meta.value?.sessionId ?? "",
      newDeviceId: () => randomId(),
      now: deps.now().getTime(),
    });
  }

  function previewImport(sources: ImportSource[]): ImportPlan {
    return planFor(sources);
  }

  /** Stores what the sources add as imported records; false if there was nothing new or it failed. */
  async function addToSession(sources: ImportSource[], employee: string): Promise<boolean> {
    const clerk = clampName(employee);
    if (!clerk) return false;
    let added = false;
    await enqueue(async () => {
      const target = store;
      if (!target) return;
      // The log may have changed since the preview, so plan again against what is here now.
      const plan = planFor(sources);
      if (!plan.anythingNew) return;
      try {
        if (!plan.records.every(isLogRecord)) throw new Error("a record was not valid");
        const written = await target.importRecords(
          plan.records,
          plan.audits.map((body) => ({ employee: clerk, body })),
        );
        if (store !== target) return;
        merge(written);
        message.value = addedMessage(plan);
        added = true;
      } catch (err) {
        console.error("session: could not add to the session", err);
        if (store !== target) return;
        const reason = err instanceof Error ? err.message : String(err);
        message.value = {
          tone: "error",
          text: `Could not add to this session, so nothing was changed. (${reason})`,
        };
      }
    });
    return added;
  }

  async function loadWorkstationName(): Promise<void> {
    workstationName.value = (await deps.getWorkstationName()) ?? null;
  }

  /** Save this workstation's name for records written from now on; false if blank or not saved. */
  async function nameWorkstation(name: string): Promise<boolean> {
    const clean = clampName(name);
    if (!clean) return false;
    try {
      await deps.setWorkstationName(clean);
    } catch (err) {
      console.error("session: could not save the workstation name", err);
      message.value = { tone: "error", text: "Could not save the workstation name" };
      return false;
    }
    workstationName.value = clean;
    message.value = null;
    return true;
  }

  return {
    screen,
    meta,
    records,
    currentVisitId,
    message,
    fatal,
    notice,
    peers,
    isolated,
    disconnected,
    mesh,
    offerScannerCard,
    state,
    currentVisit,
    lockedPatron,
    othersInProgress,
    closed,
    notConnected,
    startSession,
    leaveSession,
    resumeSession,
    changeClerk,
    toolbarDialog,
    scan,
    voidRecord,
    endPatron,
    voidPatron,
    closeSession,
    deleteSession,
    deletingSession,
    generatePdf,
    exportTable,
    printScannerCard,
    attachMesh,
    adoptJoinedSession,
    ensureMesh,
    readOffer,
    joinSession,
    knownDevices,
    listSessions,
    otherSessions,
    loadSessionSource,
    readFiles,
    previewImport,
    addToSession,
    workstationName,
    loadWorkstationName,
    nameWorkstation,
  };
});

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function addedMessage(plan: ImportPlan): Message {
  let patrons = 0;
  let items = 0;
  let voided = 0;
  for (const p of plan.sources) {
    patrons += p.adds.patrons;
    items += p.adds.items;
    voided += p.voidedBySource;
  }
  if (patrons === 0 && items === 0) {
    return {
      tone: "info",
      text:
        voided > 0
          ? `Nothing added, but ${count(voided, "item")} voided in the source.`
          : "Nothing added.",
    };
  }
  return {
    tone: "info",
    text: `Added ${count(patrons, "patron")} and ${count(items, "item")}.`,
  };
}

function seqOf(id: RecordId): number {
  return Number(id.slice(id.lastIndexOf(":") + 1));
}

function deviceOf(id: RecordId): string {
  return id.slice(0, id.lastIndexOf(":"));
}
