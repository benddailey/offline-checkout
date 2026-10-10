import { CHANNEL_LABEL, decodeWire, encodeWire, type WireMsg } from "./protocol";

export interface LinkHooks {
  /** The data channel opened: time to send hello. */
  open(link: Link): void;
  message(link: Link, msg: WireMsg): void;
  /** Called exactly once, after the link has closed. */
  closed(link: Link): void;
}

export interface LinkInit {
  /** Device that created the offer for this link. */
  offererId: string;
  /** Device we expect on the other end; null for an invite until its answer is accepted. */
  expectedId: string | null;
  /** Offer ufrag (QR pairing) or signal id (relayed): both ends know it. */
  linkId: string;
}

const noop = () => {};

/** One RTCPeerConnection + its single "oc" data channel. */
export class Link {
  readonly pc: RTCPeerConnection;
  readonly offererId: string;
  expectedId: string | null;
  linkId: string;
  /** Inviter's end of a QR pairing: its newcomer gets introduced to other peers. */
  invite = false;
  /** Set once a valid hello has been received. */
  remoteId: string | null = null;
  closed = false;
  /** Resolves on the first valid hello; rejects if the link closes first. */
  readonly handshake: Promise<void>;
  private readonly hooks: LinkHooks;
  private channel: RTCDataChannel | null = null;
  private resolveHandshake: () => void = noop;
  private rejectHandshake: (e: Error) => void = noop;
  private rejectClosed: (e: Error) => void = noop;
  private readonly whenClosed: Promise<never>;

  constructor(pc: RTCPeerConnection, init: LinkInit, hooks: LinkHooks) {
    this.pc = pc;
    this.offererId = init.offererId;
    this.expectedId = init.expectedId;
    this.linkId = init.linkId;
    this.hooks = hooks;
    this.handshake = new Promise<void>((res, rej) => {
      this.resolveHandshake = res;
      this.rejectHandshake = rej;
    });
    this.handshake.catch(noop);
    this.whenClosed = new Promise<never>((_, rej) => (this.rejectClosed = rej));
    this.whenClosed.catch(noop);
    pc.ondatachannel = (e) => this.attach(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.close();
    };
  }

  /** Offerer side: create the single ordered, reliable channel. */
  createChannel(): void {
    this.attach(this.pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
  }

  private attach(ch: RTCDataChannel): void {
    if (this.channel || ch.label !== CHANNEL_LABEL || this.closed) {
      ch.close();
      return;
    }
    this.channel = ch;
    ch.onopen = () => this.hooks.open(this);
    ch.onmessage = (e: MessageEvent) => {
      const msg = decodeWire(e.data);
      if (msg && !this.closed) this.hooks.message(this, msg);
    };
    ch.onclose = () => this.close();
    if (ch.readyState === "open") queueMicrotask(() => this.hooks.open(this));
  }

  /** Full local SDP once ICE gathering is complete (no trickle). Rejects if the link closes. */
  localSdp(): Promise<string> {
    const pc = this.pc;
    const gathered = new Promise<string>((resolve, reject) => {
      const done = () => {
        const sdp = pc.localDescription?.sdp;
        if (sdp) resolve(sdp);
        else reject(new Error("No local description"));
      };
      if (pc.iceGatheringState === "complete") return done();
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") done();
      };
    });
    return Promise.race([gathered, this.whenClosed]);
  }

  get isOpen(): boolean {
    return !this.closed && this.channel?.readyState === "open";
  }

  /** Never throws; false if the channel is not open or the send failed. */
  send(msg: WireMsg): boolean {
    if (!this.isOpen) return false;
    try {
      this.channel!.send(encodeWire(msg));
      return true;
    } catch {
      return false;
    }
  }

  helloReceived(remoteId: string): void {
    this.remoteId = remoteId;
    this.resolveHandshake();
  }

  /** Idempotent. `reason` is what a pending handshake rejects with. */
  close(reason: Error = new Error("Connection closed before the handshake completed")): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectHandshake(reason);
    this.rejectClosed(reason);
    try {
      this.channel?.close();
      this.pc.close();
    } catch {
      // already torn down
    }
    this.hooks.closed(this);
  }

  /** Duplicate-link rule: keep the link whose offerer has the lower deviceId (then lower linkId). */
  static compare(a: Link, b: Link): number {
    if (a.offererId !== b.offererId) return a.offererId < b.offererId ? -1 : 1;
    return a.linkId < b.linkId ? -1 : a.linkId > b.linkId ? 1 : 0;
  }
}
