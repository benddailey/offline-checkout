import { randomId } from "../log/ids";
import {
  PairingError,
  decodePayload,
  encodePayload,
  type PairingPayload,
} from "../pairing/payload";
import { minifySdp, rebuildSdp, type SdpParts } from "../pairing/sdp";
import { Link } from "./link";
import type { HelloMsg, IntroMsg, SignalMsg, WireMsg } from "./protocol";

export interface PeerInfo {
  deviceId: string;
  employee: string;
  connected: boolean;
}
export type RtcFactory = (config: RTCConfiguration) => RTCPeerConnection;
export interface MeshOptions {
  sessionId: string;
  sessionName: string;
  deviceId: string;
  employee: string;
  /** Defaults to the browser's RTCPeerConnection; tests inject the fake network. */
  rtc?: RtcFactory;
  /** Devices in the session's record log; with peers seen this session, the auto-reconnect targets. */
  knownDevices: () => Set<string>;
  offerTtlMs?: number;
  retryMs?: number;
  now?: () => number;
}
export interface Invite {
  /** "OC2:…" text for the QR code / copy box. */
  payload: string;
  expiresAt: number;
  /** Resolves when the joiner's hello arrives. PairingError: expired (TTL, cancelled or second use), wrong-session, malformed, wrong-kind. */
  accept(answerText: string): Promise<PeerInfo>;
  /** Abandon the invite and close its connection, unless its joiner has already said hello. */
  cancel(): void;
}

/** Subscriber errors are logged, never allowed to abort mesh state updates. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error("mesh subscriber failed", e);
  }
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };
/** Unsubscribed app messages kept for the first subscriber; the oldest are dropped beyond this. */
const MAX_BACKLOG = 1000;
const browserRtc: RtcFactory = (config) => new RTCPeerConnection(config);
const expired = () =>
  new PairingError("expired", "This pairing code has expired. Create a new one.");
const wrongSession = () =>
  new PairingError("wrong-session", "That workstation belongs to a different session.");

export class Mesh {
  readonly sessionId: string;
  readonly sessionName: string;
  readonly deviceId: string;
  private employee: string;
  private readonly rtc: RtcFactory;
  private readonly knownDevices: () => Set<string>;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly links = new Set<Link>();
  /** Connected peers: the one link kept per remote device. */
  private readonly active = new Map<string, Link>();
  /** Every device that completed hello this session → its latest employee name. */
  private readonly seen = new Map<string, string>();
  /** Outgoing relayed offers awaiting answer + hello, by target device, with start time. */
  private readonly dials = new Map<string, { link: Link; at: number }>();
  /** TTL timers of open invites, cleared when their link closes. */
  private readonly inviteTimers = new Map<Link, ReturnType<typeof setTimeout>>();
  private linkSeq = 0;
  private readonly retryMs: number;
  private readonly signalsHandled = new Set<string>();
  private readonly messageCbs = new Set<(peerId: string, msg: unknown) => void>();
  /**
   * App messages that arrived while nobody was subscribed (a joined mesh before the app adopts
   * it), delivered in order to the first subscriber so nothing sent at connect is lost.
   */
  private backlog: [string, unknown][] = [];
  private flushQueued = false;
  private readonly peerCbs = new Set<(peers: PeerInfo[]) => void>();
  private readonly retryTimer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(o: MeshOptions) {
    this.sessionId = o.sessionId;
    this.sessionName = o.sessionName;
    this.deviceId = o.deviceId;
    this.employee = o.employee;
    this.rtc = o.rtc ?? browserRtc;
    this.knownDevices = o.knownDevices;
    this.ttl = o.offerTtlMs ?? 300_000;
    this.now = o.now ?? Date.now;
    this.retryMs = o.retryMs ?? 10_000;
    this.retryTimer = setInterval(() => this.reconnect(), this.retryMs);
  }

  /** "Add workstation": an offer QR, single-use, valid for offerTtlMs. */
  async createInvite(): Promise<Invite> {
    const link = this.newLink({
      offererId: this.deviceId,
      expectedId: null,
      linkId: this.nextLinkId(),
    });
    link.invite = true;
    let sdp: SdpParts;
    try {
      link.createChannel();
      await link.pc.setLocalDescription(await link.pc.createOffer());
      sdp = minifySdp(await link.localSdp());
    } catch (e) {
      link.close();
      throw e;
    }
    const payload = encodePayload({
      kind: "offer",
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      deviceId: this.deviceId,
      employee: this.employee,
      sdp,
    });
    const expiresAt = this.now() + this.ttl;
    let used = false;
    let cancelled = false;
    this.inviteTimers.set(
      link,
      setTimeout(() => link.close(expired()), this.ttl),
    );
    const stopTimer = () => {
      clearTimeout(this.inviteTimers.get(link));
      this.inviteTimers.delete(link);
    };
    const cancel = () => {
      if (used) {
        // Accepted but never connected (e.g. the clerk gave up waiting): don't leave it open.
        if (!link.remoteId) link.close(expired());
        return;
      }
      cancelled = true;
      link.close(expired());
    };
    const accept = async (answerText: string): Promise<PeerInfo> => {
      if (used) throw expired();
      if (cancelled || link.closed || this.now() >= expiresAt) {
        cancel();
        throw expired();
      }
      const answer = decodePayload(answerText, "answer");
      if (answer.sessionId !== this.sessionId) throw wrongSession();
      used = true;
      stopTimer();
      link.expectedId = answer.deviceId;
      try {
        await link.pc.setRemoteDescription({
          type: "answer",
          sdp: rebuildSdp(answer.sdp, "answer"),
        });
      } catch {
        const err = new PairingError("malformed", "This pairing answer could not be used");
        link.close(err);
        throw err;
      }
      await link.handshake;
      return this.peerInfo(answer.deviceId);
    };
    return { payload, expiresAt, accept, cancel };
  }

  /** Answer a scanned/pasted offer. The returned mesh belongs to the offer's session. */
  static async join(
    offerText: string,
    o: Omit<MeshOptions, "sessionId" | "sessionName">,
  ): Promise<{ mesh: Mesh; offer: PairingPayload; answer: string; connected: Promise<PeerInfo> }> {
    const offer = decodePayload(offerText, "offer");
    const mesh = new Mesh({ ...o, sessionId: offer.sessionId, sessionName: offer.sessionName });
    try {
      // linkId is learnt from the inviter's hello.
      const link = mesh.newLink({
        offererId: offer.deviceId,
        expectedId: offer.deviceId,
        linkId: "",
      });
      await link.pc.setRemoteDescription({ type: "offer", sdp: rebuildSdp(offer.sdp, "offer") });
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      const answer = encodePayload({
        kind: "answer",
        sessionId: offer.sessionId,
        sessionName: offer.sessionName,
        deviceId: o.deviceId,
        employee: o.employee,
        sdp: minifySdp(await link.localSdp()),
      });
      const connected = link.handshake.then(() => mesh.peerInfo(offer.deviceId));
      connected.catch(() => {});
      return { mesh, offer, answer, connected };
    } catch (e) {
      mesh.close();
      throw e;
    }
  }

  /** Returns false (never throws) when the peer is not connected or the send failed. */
  send(peerId: string, msg: unknown): boolean {
    return this.active.get(peerId)?.send({ t: "app", body: msg }) ?? false;
  }

  broadcast(msg: unknown): void {
    for (const link of this.active.values()) link.send({ t: "app", body: msg });
  }

  onMessage(cb: (peerId: string, msg: unknown) => void): () => void {
    this.messageCbs.add(cb);
    this.scheduleFlush();
    return () => this.messageCbs.delete(cb);
  }

  onPeerChange(cb: (peers: PeerInfo[]) => void): () => void {
    this.peerCbs.add(cb);
    return () => this.peerCbs.delete(cb);
  }

  /** Every device seen this session, connected or not, sorted by deviceId. */
  peers(): PeerInfo[] {
    return [...this.seen.keys()].sort().map((id) => this.peerInfo(id));
  }

  setEmployee(name: string): void {
    this.employee = name;
    for (const link of this.active.values()) link.send(this.hello());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.retryTimer);
    for (const timer of this.inviteTimers.values()) clearTimeout(timer);
    this.inviteTimers.clear();
    for (const link of this.links) link.close(); // Set iteration tolerates deletion
    this.messageCbs.clear();
    this.peerCbs.clear();
    this.backlog = [];
  }

  private peerInfo(id: string): PeerInfo {
    return { deviceId: id, employee: this.seen.get(id) ?? "", connected: this.active.has(id) };
  }

  private hello(link?: Link): HelloMsg {
    const { sessionId, deviceId, employee } = this;
    const msg: HelloMsg = { t: "hello", sessionId, deviceId, employee };
    if (link?.offererId === deviceId) msg.link = link.linkId;
    return msg;
  }

  private emit(): void {
    if (this.closed) return;
    const peers = this.peers();
    for (const cb of this.peerCbs) safely(() => cb(peers));
  }

  /** Zero-padded time + per-mesh counter + random suffix: later ids from one offerer sort higher. */
  private nextLinkId(): string {
    const t = String(this.now()).padStart(15, "0");
    return `${t}.${String(++this.linkSeq).padStart(6, "0")}.${randomId(4)}`;
  }

  private newLink(init: ConstructorParameters<typeof Link>[1]): Link {
    if (this.closed) throw new Error("Mesh is closed");
    const link = new Link(this.rtc(RTC_CONFIG), init, {
      open: (l) => l.send(this.hello(l)),
      message: (l, m) => this.onWire(l, m),
      closed: (l) => this.onLinkClosed(l),
    });
    this.links.add(link);
    return link;
  }

  private onWire(link: Link, msg: WireMsg): void {
    if (msg.t === "hello") return this.onHello(link, msg);
    const from = link.remoteId;
    if (!from || this.closed) return; // nothing but hello before the handshake
    if (msg.t === "intro") this.onIntro(msg);
    else if (msg.t === "signal") this.onSignal(from, msg);
    else this.deliver(from, msg.body);
  }

  private deliver(from: string, body: unknown): void {
    if (this.messageCbs.size > 0 && this.backlog.length === 0) {
      for (const cb of this.messageCbs) safely(() => cb(from, body));
      return;
    }
    this.backlog.push([from, body]);
    if (this.backlog.length > MAX_BACKLOG) this.backlog.shift();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushQueued || this.messageCbs.size === 0 || this.backlog.length === 0) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      if (this.closed || this.messageCbs.size === 0) return;
      const pending = this.backlog;
      this.backlog = [];
      for (const [from, body] of pending) {
        for (const cb of this.messageCbs) safely(() => cb(from, body));
      }
    });
  }

  private onHello(link: Link, h: HelloMsg): void {
    if (h.sessionId !== this.sessionId) return link.close(wrongSession());
    const id = h.deviceId;
    if (id === this.deviceId || (link.expectedId && id !== link.expectedId)) return link.close();
    const nameChanged = this.seen.get(id) !== h.employee;
    this.seen.set(id, h.employee);
    if (link.remoteId) {
      if (nameChanged) this.emit(); // re-hello after setEmployee
      return;
    }
    if (link.offererId === id) {
      if (!h.link) return link.close();
      link.linkId = h.link;
    }
    link.helloReceived(id);
    const dial = this.dials.get(id);
    if (dial) {
      this.dials.delete(id);
      // Connected another way. A dial whose channel is already open may have said hello at the
      // far end, which then ranks it with the duplicate rule; only unopened dials are dropped.
      if (dial.link !== link && !dial.link.isOpen) dial.link.close();
    }

    const current = this.active.get(id);
    if (current && current !== link) {
      // Duplicate link to a connected device: both ends keep the same one, peer stays connected.
      // A QR pairing that just completed wins outright: the joiner is a fresh mesh with no other
      // link, so the existing one is stale (e.g. the joiner's page reloaded unnoticed).
      if (link.invite || Link.compare(link, current) < 0) {
        this.active.set(id, link);
        current.close();
      } else {
        link.close();
        if (nameChanged) this.emit();
        return;
      }
    } else {
      this.active.set(id, link);
    }

    if (link.invite) {
      const intro: IntroMsg = { t: "intro", deviceId: id, employee: h.employee };
      for (const [peerId, other] of this.active) if (peerId !== id) other.send(intro);
    }
    if (!current || nameChanged) this.emit();
  }

  private onLinkClosed(link: Link): void {
    this.links.delete(link);
    clearTimeout(this.inviteTimers.get(link));
    this.inviteTimers.delete(link);
    const id = link.remoteId ?? link.expectedId;
    if (!id) return;
    if (this.dials.get(id)?.link === link) this.dials.delete(id);
    if (this.active.get(id) !== link) return;
    this.active.delete(id);
    // Hand over to another open link to the same device (its hello is in flight) without flapping.
    for (const other of this.links) {
      if (other.isOpen && !other.remoteId && other.expectedId === id) {
        this.active.set(id, other);
        return;
      }
    }
    if (this.active.size === 0) {
      // Nobody left to relay through: pending dials can never be answered.
      for (const { link: dial } of this.dials.values()) dial.close();
      this.dials.clear();
    }
    this.emit();
  }

  private onIntro(m: IntroMsg): void {
    const id = m.deviceId;
    if (id !== this.deviceId && !this.active.has(id) && !this.dials.has(id)) void this.dial(id);
  }

  /** Lower deviceId re-dials known/seen devices through every connected peer. */
  private reconnect(): void {
    if (this.closed || this.active.size === 0) return;
    const targets = new Set([...this.knownDevices(), ...this.seen.keys()]);
    for (const id of targets) {
      if (id > this.deviceId && !this.active.has(id)) void this.dial(id);
    }
  }

  private relay(msg: SignalMsg): void {
    for (const link of this.active.values()) link.send(msg);
  }

  private async dial(target: string): Promise<void> {
    if (this.closed) return;
    const pending = this.dials.get(target);
    if (pending && this.now() - pending.at < this.retryMs) return;
    pending?.link.close();
    const id = this.nextLinkId();
    const link = this.newLink({ offererId: this.deviceId, expectedId: target, linkId: id });
    this.dials.set(target, { link, at: this.now() });
    try {
      link.createChannel();
      await link.pc.setLocalDescription(await link.pc.createOffer());
      const sdp = await link.localSdp();
      this.relay({ t: "signal", from: this.deviceId, to: target, id, kind: "offer", sdp });
    } catch {
      link.close();
    }
  }

  private onSignal(via: string, m: SignalMsg): void {
    if (m.to !== this.deviceId) {
      // One hop only: forward signals that came straight from their originator.
      if (via === m.from) this.active.get(m.to)?.send(m);
      return;
    }
    const key = `${m.kind}:${m.id}`;
    if (m.from === this.deviceId || this.signalsHandled.has(key)) return;
    this.signalsHandled.add(key);
    if (m.kind === "offer") void this.answerOffer(m);
    else void this.applyAnswer(m);
  }

  private async answerOffer(m: SignalMsg): Promise<void> {
    // A newer offer from the same device supersedes our unfinished answers to it.
    for (const l of this.links) {
      if (l.offererId === m.from && l.expectedId === m.from && !l.remoteId) l.close();
    }
    if (this.closed) return;
    const link = this.newLink({ offererId: m.from, expectedId: m.from, linkId: m.id });
    try {
      await link.pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      const sdp = await link.localSdp();
      this.relay({ t: "signal", from: this.deviceId, to: m.from, id: m.id, kind: "answer", sdp });
    } catch {
      link.close();
    }
  }

  private async applyAnswer(m: SignalMsg): Promise<void> {
    const link = this.dials.get(m.from)?.link;
    if (!link || link.linkId !== m.id) return;
    try {
      await link.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
    } catch {
      link.close();
    }
  }
}
