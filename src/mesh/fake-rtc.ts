/**
 * In-memory stand-in for RTCPeerConnection/RTCDataChannel, implementing only what Mesh uses.
 * Test-only: production code never imports this.
 *
 * Each fake PC belongs to a device (via `factoryFor(deviceId)`), so `cut(a, b)` can drop
 * every live link between two devices. Offers/answers are `rebuildSdp` output with a unique
 * ufrag; applying an answer links the two fakes by ufrag and opens the channel pair.
 */
import { minifySdp, rebuildSdp } from "../pairing/sdp";
import type { RtcFactory } from "./mesh";

const FINGERPRINT = Array.from({ length: 32 }, (_, i) =>
  i.toString(16).toUpperCase().padStart(2, "0"),
).join(":");

type Handler<E> = ((ev: E) => void) | null;

class FakeChannel {
  readonly label: string;
  readonly ordered = true;
  readyState: RTCDataChannelState = "connecting";
  peer: FakeChannel | null = null;
  onopen: Handler<Event> = null;
  onclose: Handler<Event> = null;
  onmessage: Handler<{ data: string }> = null;

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    if (this.readyState !== "open") throw new Error("InvalidStateError: channel not open");
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer?.readyState === "open") peer.onmessage?.({ data });
    });
  }

  open(): void {
    if (this.readyState !== "connecting") return;
    this.readyState = "open";
    this.onopen?.(new Event("open"));
  }

  /** Close this end and notify it; `quiet` skips the event (as pc.close() does locally). */
  shut(quiet = false): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    if (!quiet) queueMicrotask(() => this.onclose?.(new Event("close")));
  }

  /** The far end closes after messages already in flight are delivered (like SCTP). */
  close(): void {
    this.shut();
    const peer = this.peer;
    queueMicrotask(() => peer?.shut());
  }
}

class FakePeerConnection {
  readonly owner: string;
  readonly ufrag: string;
  private readonly net: Network;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteUfrag: string | null = null;
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  onicegatheringstatechange: Handler<Event> = null;
  onconnectionstatechange: Handler<Event> = null;
  ondatachannel: Handler<{ channel: FakeChannel }> = null;
  channel: FakeChannel | null = null;
  remote: FakePeerConnection | null = null;

  constructor(owner: string, net: Network) {
    this.owner = owner;
    this.net = net;
    this.ufrag = `u${owner}${++net.counter}`;
    net.byUfrag.set(this.ufrag, this);
  }

  createDataChannel(label: string): FakeChannel {
    this.channel = new FakeChannel(label);
    return this.channel;
  }

  private description(type: "offer" | "answer"): RTCSessionDescriptionInit {
    const parts = {
      ufrag: this.ufrag,
      pwd: `p${this.ufrag}`,
      fingerprint: FINGERPRINT,
      candidates:
        this.net.gathering.get(this.owner) === "stall-empty"
          ? []
          : [{ address: `${this.owner}.local`, port: 50000 + this.net.counter }],
    };
    return { type, sdp: rebuildSdp(parts, type) };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return this.description("offer");
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.remoteUfrag) throw new Error("InvalidStateError: no remote offer");
    return this.description("answer");
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
    this.iceGatheringState = "gathering";
    if (this.net.gathering.has(this.owner)) return; // stalled: never reaches "complete"
    queueMicrotask(() => {
      this.iceGatheringState = "complete";
      this.onicegatheringstatechange?.(new Event("icegatheringstatechange"));
    });
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (this.connectionState === "closed") throw new Error("InvalidStateError: closed");
    this.remoteUfrag = minifySdp(desc.sdp ?? "").ufrag;
    if (desc.type !== "answer") return;
    const answerer = this.net.byUfrag.get(this.remoteUfrag);
    // The answer must come from a PC that took *this* offer.
    if (!answerer || answerer.remoteUfrag !== this.ufrag || !this.channel) return;
    queueMicrotask(() => this.link(answerer));
  }

  private link(answerer: FakePeerConnection): void {
    const local = this.channel;
    if (!local || this.connectionState === "closed" || answerer.connectionState === "closed") {
      return;
    }
    const far = new FakeChannel(local.label);
    local.peer = far;
    far.peer = local;
    this.remote = answerer;
    answerer.remote = this;
    answerer.channel = far;
    for (const pc of [this, answerer]) pc.setConnectionState("connected");
    answerer.ondatachannel?.({ channel: far });
    local.open();
    far.open();
  }

  setConnectionState(s: RTCPeerConnectionState): void {
    if (this.connectionState === s || this.connectionState === "closed") return;
    this.connectionState = s;
    this.onconnectionstatechange?.(new Event("connectionstatechange"));
  }

  /** Link dropped by the network: both channels close, both PCs go "failed". */
  drop(): void {
    const remote = this.remote;
    this.channel?.close();
    this.setConnectionState("failed");
    remote?.setConnectionState("failed");
  }

  /** Only this side notices the failure; the remote end keeps a stale, silent link. */
  failLocally(): void {
    const channel = this.channel;
    if (channel) channel.peer = null;
    this.remote = null;
    channel?.shut();
    this.setConnectionState("failed");
  }

  close(): void {
    if (this.connectionState === "closed") return;
    this.connectionState = "closed";
    this.channel?.shut(true);
    const peer = this.channel?.peer;
    const remote = this.remote;
    queueMicrotask(() => {
      peer?.shut();
      remote?.setConnectionState("failed");
    });
    this.net.byUfrag.delete(this.ufrag);
  }
}

class Network {
  counter = 0;
  byUfrag = new Map<string, FakePeerConnection>();
  all: FakePeerConnection[] = [];
  gathering = new Map<string, GatheringMode>();
}

/** "stall": gathering never completes (host candidate present); "stall-empty": and no candidates. */
export type GatheringMode = "stall" | "stall-empty";

export interface FakeRtcNetwork {
  /** RTC factory whose connections belong to `deviceId`. */
  factoryFor(deviceId: string): RtcFactory;
  /** Drop every live link between devices a and b (fires `close` on both channels). */
  cut(a: string, b: string): void;
  /** Only `a` sees its live links to `b` fail (channel close + "failed"); `b` is not told. */
  fail(a: string, b: string): void;
  /** Make ICE gathering misbehave for PCs a device creates from now on; null restores it. */
  setGathering(deviceId: string, mode: GatheringMode | null): void;
  /** Number of PCs a device has created (to observe dial attempts). */
  created(deviceId: string): number;
  /** PCs a device has that are neither closed nor live (unfinished dials/answers/invites). */
  pending(deviceId: string): number;
  /** Live (connected, open-channel) links a device has, by remote device. */
  liveLinks(deviceId: string): string[];
}

export function createFakeRtcNetwork(): FakeRtcNetwork {
  const net = new Network();
  const live = (pc: FakePeerConnection) =>
    pc.connectionState === "connected" && pc.channel?.readyState === "open" && pc.remote;
  return {
    factoryFor(deviceId) {
      return (config) => {
        if (config.iceServers?.length) throw new Error("fake RTC expects iceServers: []");
        const pc = new FakePeerConnection(deviceId, net);
        net.all.push(pc);
        return pc as unknown as RTCPeerConnection;
      };
    },
    cut(a, b) {
      for (const pc of net.all) {
        if (pc.owner === a && pc.remote?.owner === b && live(pc)) pc.drop();
      }
    },
    fail(a, b) {
      for (const pc of net.all) {
        if (pc.owner === a && pc.remote?.owner === b && live(pc)) pc.failLocally();
      }
    },
    setGathering(deviceId, mode) {
      if (mode) net.gathering.set(deviceId, mode);
      else net.gathering.delete(deviceId);
    },
    created(deviceId) {
      return net.all.filter((pc) => pc.owner === deviceId).length;
    },
    pending(deviceId) {
      return net.all.filter(
        (pc) => pc.owner === deviceId && pc.connectionState !== "closed" && !live(pc),
      ).length;
    },
    liveLinks(deviceId) {
      return net.all
        .filter((pc) => pc.owner === deviceId && live(pc))
        .map((pc) => pc.remote!.owner)
        .sort();
    },
  };
}
