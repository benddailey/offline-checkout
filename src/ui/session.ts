import { defineStore } from "pinia";
import { computed, nextTick, ref, shallowRef } from "vue";
import { CONTROL, normalizeScan, validateBarcode } from "../log/barcode";
import { clampName } from "../log/limits";
import { checkItem } from "../log/duplicates";
import { recordId } from "../log/ids";
import { reduce } from "../log/reduce";
import type { ItemState, LogRecord, RecordBody, RecordId, VisitState } from "../log/types";
import { Mesh, type MeshOptions, type PeerInfo } from "../mesh/mesh";
import { isPairingText } from "../pairing/chunks";
import { PairingError, decodePayload, type PairingPayload } from "../pairing/payload";
import { downloadBlob, renderScannerCard, renderSessionPdf } from "../pdf/render";
import { buildCsv } from "../export/csv";
import { exportRows } from "../export/rows";
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
  acquireSessionLock: typeof db.acquireSessionLock;
  requestPersistence: typeof db.requestPersistence;
  renderSessionPdf: typeof renderSessionPdf;
  renderScannerCard: typeof renderScannerCard;
  downloadBlob: typeof downloadBlob;
  getDeviceId: typeof db.getDeviceId;
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
    acquireSessionLock: db.acquireSessionLock,
    requestPersistence: db.requestPersistence,
    renderSessionPdf,
    renderScannerCard,
    downloadBlob,
    getDeviceId: db.getDeviceId,
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

  const state = computed(() => reduce(records.value));
  /**
   * Cut off from a session that has other workstations: after a reload, crash or sleep, or a
   * lost link. A brand-new session that has only ever been on this machine is not "disconnected".
   */
  const disconnected = computed(() => {
    if (!isolated.value || !meta.value) return false;
    const own = meta.value.deviceId;
    return hadPeer.value || records.value.some((r) => r.deviceId !== own);
  });
  const closed = computed(() => state.value.closed);
  /**
   * Other workstations in this session's log that are not connected now: their latest scans may
   * be missing here. Named by the clerk on each one's latest (highest seq) record.
   */
  const notConnected = computed<{ deviceId: string; employee: string }[]>(() => {
    const own = meta.value?.deviceId;
    const connected = new Set(peers.value.filter((p) => p.connected).map((p) => p.deviceId));
    const latest = new Map<string, LogRecord>();
    for (const r of records.value) {
      if (r.deviceId === own || connected.has(r.deviceId)) continue;
      const prev = latest.get(r.deviceId);
      if (!prev || r.seq > prev.seq) latest.set(r.deviceId, r);
    }
    const out = new Map<string, string>();
    for (const r of latest.values()) out.set(r.deviceId, r.employee);
    // Peers seen this page load that dropped, even if none of their records have arrived.
    for (const p of peers.value) {
      if (!p.connected && p.deviceId !== own && !out.has(p.deviceId)) {
        out.set(p.deviceId, p.employee);
      }
    }
    return [...out]
      .map(([deviceId, employee]) => ({ deviceId, employee }))
      .sort((a, b) => a.employee.localeCompare(b.employee) || (a.deviceId < b.deviceId ? -1 : 1));
  });
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
      .filter((v) => v.deviceId !== own && !v.ended && !v.voided)
      .map((v) => ({ employee: v.employee, patron: v.patron }));
  });

  let store: SessionStore | null = null;
  let releaseLock: (() => void) | null = null;
  let sync: SyncEngine | null = null;
  let unsubPeers: (() => void) | null = null;
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
    hadPeer.value = false;
  }

  /** Release the session here (lock, store, mesh) and go back to Launch. */
  function leaveSession(): void {
    teardown();
    screen.value = "launch";
  }

  /** Lock, load and show the session; on a held lock sets `notice`, on failure sets `fatal`, and returns false. */
  async function open(
    sessionId: string,
    openStore: () => Promise<SessionStore>,
    employee?: string,
  ): Promise<boolean> {
    teardown();
    try {
      const release = await deps.acquireSessionLock(sessionId);
      if (!release) {
        notice.value = LOCKED_MESSAGE;
        screen.value = "launch";
        return false;
      }
      releaseLock = release;
      store = await openStore();
      if (employee !== undefined && (await store.meta()).employee !== employee) {
        await store.setEmployee(employee);
      }
      meta.value = await store.meta();
      merge(await store.all());
      void deps.requestPersistence();
      return true;
    } catch (err) {
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

  async function resumeSession(sessionId: string): Promise<void> {
    if (!(await open(sessionId, () => deps.openSessionStore(sessionId)))) return;
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
    }
    mesh.value = m;
    const setPeers = (list: PeerInfo[]) => {
      peers.value = list;
      isolated.value = !list.some((p) => p.connected);
      if (!isolated.value) hadPeer.value = true;
    };
    unsubPeers = m.onPeerChange(setPeers);
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
    return new Set(records.value.map((r) => r.deviceId));
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

  function generatePdf(): void {
    if (!meta.value || state.value.totals.patrons === 0) return;
    try {
      const date = deps.now();
      const blob = deps.renderSessionPdf(state.value, { date });
      deps.downloadBlob(blob, `offline-checkout-${fileSafe(meta.value.name)}-${ymd(date)}.pdf`);
    } catch (err) {
      console.error("session: PDF failed", err);
      message.value = { tone: "error", text: "Could not create the PDF" };
    }
  }

  function exportTable(format: "csv" | "xlsx"): void {
    if (!meta.value || state.value.totals.patrons === 0) return;
    try {
      const date = deps.now();
      const rows = exportRows(state.value);
      const blob =
        format === "csv"
          ? new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" })
          : new Blob([buildXlsx(state.value, rows, date)], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
      deps.downloadBlob(
        blob,
        `offline-checkout-${fileSafe(meta.value.name)}-${ymd(date)}.${format}`,
      );
    } catch (err) {
      console.error(`session: ${format} export failed`, err);
      message.value = {
        tone: "error",
        text: `Could not create the ${format === "csv" ? "CSV" : "Excel"} file`,
      };
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

  function listSessions(): Promise<SessionSummary[]> {
    return deps.listSessions();
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
    scan,
    voidRecord,
    endPatron,
    voidPatron,
    closeSession,
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
  };
});

function seqOf(id: RecordId): number {
  return Number(id.slice(id.lastIndexOf(":") + 1));
}

function deviceOf(id: RecordId): string {
  return id.slice(0, id.lastIndexOf(":"));
}
