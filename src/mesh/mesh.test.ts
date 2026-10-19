import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { decodePayload, encodePayload, PairingError } from "../pairing/payload";
import { createFakeRtcNetwork, type FakeRtcNetwork } from "./fake-rtc";
import { NO_ADDRESS } from "./link";
import { dev, mk, SID } from "../log/helpers.test-util";
import type { LogRecord } from "../log/types";
import { missingFor, vectorOf } from "../log/vector";
import { SyncEngine, type StoreLike } from "../sync/sync";
import { Mesh, type MeshOptions, type PeerInfo } from "./mesh";

const RETRY = 10_000;
const TTL = 300_000;
const SESSION = { sessionId: "s1", sessionName: "Book Fair" };

let net: FakeRtcNetwork;
let meshes: Mesh[];

type JoinOpts = Omit<MeshOptions, "sessionId" | "sessionName">;

function opts(deviceId: string, employee: string, extra: Partial<JoinOpts> = {}): JoinOpts {
  return {
    deviceId,
    employee,
    rtc: net.factoryFor(deviceId),
    knownDevices: () => new Set<string>(),
    ...extra,
  };
}

function track(m: Mesh): Mesh {
  meshes.push(m);
  return m;
}

function founder(deviceId = "A", employee = "Ann", extra: Partial<JoinOpts> = {}): Mesh {
  return track(new Mesh({ ...SESSION, ...opts(deviceId, employee, extra) }));
}

/** Let queued data-channel deliveries and signaling chains run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

async function pair(inviter: Mesh, deviceId: string, employee: string, extra?: Partial<JoinOpts>) {
  const invite = await inviter.createInvite();
  const j = await Mesh.join(invite.payload, opts(deviceId, employee, extra));
  track(j.mesh);
  const accepted = await invite.accept(j.answer);
  const connected = await j.connected;
  await settle();
  return { mesh: j.mesh, accepted, connected, invite, offer: j.offer };
}

const view = (m: Mesh) =>
  Object.fromEntries(m.peers().map((p) => [p.deviceId, p.connected] as const));

async function expectPairingError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PairingError);
  expect((err as PairingError).code).toBe(code);
}

beforeEach(() => {
  vi.useFakeTimers();
  net = createFakeRtcNetwork();
  meshes = [];
});

afterEach(() => {
  for (const m of meshes) m.close();
  vi.useRealTimers();
});

describe("QR pairing", () => {
  test("B joins A's invite: both sides see each other connected", async () => {
    const a = founder();
    const { mesh: b, accepted, connected, offer } = await pair(a, "B", "Bob");
    expect(connected).toEqual<PeerInfo>({ deviceId: "A", employee: "Ann", connected: true });
    expect(accepted).toEqual<PeerInfo>({ deviceId: "B", employee: "Bob", connected: true });
    expect(offer).toMatchObject({ kind: "offer", ...SESSION, deviceId: "A", employee: "Ann" });
    expect(b.sessionId).toBe("s1");
    expect(b.sessionName).toBe("Book Fair");
    expect(a.peers()).toEqual([{ deviceId: "B", employee: "Bob", connected: true }]);
    expect(b.peers()).toEqual([{ deviceId: "A", employee: "Ann", connected: true }]);
  });

  test("invite payload survives whitespace (pasted text)", async () => {
    const a = founder();
    const invite = await a.createInvite();
    expect(invite.expiresAt).toBe(Date.now() + TTL);
    const spaced = invite.payload.replace(/(.{20})/g, "$1\n ");
    const j = await Mesh.join(spaced, opts("B", "Bob"));
    track(j.mesh);
    await invite.accept(` ${j.answer}\n`);
    await expect(j.connected).resolves.toMatchObject({ deviceId: "A" });
  });

  test("app message A→B is delivered; send to an unknown peer is a silent no-op", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const got: [string, unknown][] = [];
    b.onMessage((from, msg) => got.push([from, msg]));
    expect(a.send("B", { hi: 1 })).toBe(true);
    a.broadcast("all");
    expect(a.send("nobody", "x")).toBe(false);
    await settle();
    expect(got).toEqual([
      ["A", { hi: 1 }],
      ["A", "all"],
    ]);
  });

  test("invite accepted after offerTtlMs throws expired", async () => {
    const a = founder();
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    vi.advanceTimersByTime(TTL);
    await expectPairingError(invite.accept(j.answer), "expired");
    expect(a.peers()).toEqual([]);
  });

  test("expiry uses the injected clock", async () => {
    let t = 1_000;
    const a = founder("A", "Ann", { now: () => t, offerTtlMs: 60_000 });
    const invite = await a.createInvite();
    expect(invite.expiresAt).toBe(61_000);
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    t = 61_000;
    await expectPairingError(invite.accept(j.answer), "expired");
  });

  test("same invite accepted twice: second throws expired, first link stays up", async () => {
    const a = founder();
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    await invite.accept(j.answer);
    await expectPairingError(invite.accept(j.answer), "expired");
    await settle();
    expect(view(a)).toEqual({ B: true });
  });

  test("cancelled invite cannot be accepted", async () => {
    const a = founder();
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    invite.cancel();
    await expectPairingError(invite.accept(j.answer), "expired");
  });

  test("answer for a different session is rejected with wrong-session", async () => {
    const a = founder();
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    const forged = encodePayload({ ...decodePayload(j.answer, "answer"), sessionId: "other" });
    await expectPairingError(invite.accept(forged), "wrong-session");
  });

  test("an offer pasted where an answer is expected is wrong-kind", async () => {
    const a = founder();
    const invite = await a.createInvite();
    await expectPairingError(invite.accept(invite.payload), "wrong-kind");
  });

  test("peer whose hello carries a different sessionId is dropped", async () => {
    const a = founder();
    const invite = await a.createInvite();
    // B believes it is in session s2 but its answer is relabelled s1 to get past accept().
    const offer = decodePayload(invite.payload, "offer");
    const j = await Mesh.join(encodePayload({ ...offer, sessionId: "s2" }), opts("B", "Bob"));
    track(j.mesh);
    const relabelled = encodePayload({ ...decodePayload(j.answer, "answer"), sessionId: "s1" });
    await expectPairingError(invite.accept(relabelled), "wrong-session");
    await expectPairingError(j.connected, "wrong-session");
    await settle();
    expect(a.peers()).toEqual([]);
    expect(j.mesh.peers()).toEqual([]);
    expect(net.liveLinks("A")).toEqual([]);
  });

  test("setEmployee re-announces the name to peers", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const changes: PeerInfo[][] = [];
    a.onPeerChange((p) => changes.push(p));
    b.setEmployee("Bea");
    await settle();
    expect(a.peers()).toEqual([{ deviceId: "B", employee: "Bea", connected: true }]);
    expect(changes).toHaveLength(1);
  });
});

describe("introductions", () => {
  test("C joins via A → B and C connect directly (full mesh)", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const { mesh: c } = await pair(a, "C", "Cat");
    expect(view(a)).toEqual({ B: true, C: true });
    expect(view(b)).toEqual({ A: true, C: true });
    expect(view(c)).toEqual({ A: true, B: true });
    expect(net.liveLinks("B")).toEqual(["A", "C"]);
    expect(net.liveLinks("C")).toEqual(["A", "B"]);
    expect(c.peers().find((p) => p.deviceId === "B")?.employee).toBe("Bob");

    const got: unknown[] = [];
    c.onMessage((from, msg) => got.push([from, msg]));
    b.send("C", "direct");
    await settle();
    expect(got).toEqual([["B", "direct"]]);
  });

  test("four devices form a full mesh", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const { mesh: c } = await pair(b, "C", "Cat");
    const { mesh: d } = await pair(c, "D", "Dan");
    for (const [m, id] of [
      [a, "A"],
      [b, "B"],
      [c, "C"],
      [d, "D"],
    ] as const) {
      expect(m.peers().filter((p) => p.connected)).toHaveLength(3);
      expect(net.liveLinks(id)).toHaveLength(3);
    }
  });
});

describe("reconnection", () => {
  async function trio() {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const { mesh: c } = await pair(a, "C", "Cat");
    return { a, b, c };
  }

  test("cut(B, C) → after retryMs B and C reconnect via A, without A noticing", async () => {
    const { a, b, c } = await trio();
    const aChanges: PeerInfo[][] = [];
    a.onPeerChange((p) => aChanges.push(p));

    net.cut("B", "C");
    await settle();
    expect(view(b)).toEqual({ A: true, C: false });
    expect(view(c)).toEqual({ A: true, B: false });

    await vi.advanceTimersByTimeAsync(RETRY);
    await settle();
    expect(view(b)).toEqual({ A: true, C: true });
    expect(view(c)).toEqual({ A: true, B: true });
    expect(net.liveLinks("B")).toEqual(["A", "C"]);
    expect(aChanges).toEqual([]);

    const got: unknown[] = [];
    b.onMessage((from, msg) => got.push([from, msg]));
    c.send("B", "back");
    await settle();
    expect(got).toEqual([["C", "back"]]);
  });

  test("isolated C: its peers go connected:false and stay so", async () => {
    const { a, b, c } = await trio();
    net.cut("C", "A");
    net.cut("C", "B");
    await settle();
    expect(view(c)).toEqual({ A: false, B: false });
    expect(c.peers().map((p) => p.employee)).toEqual(["Ann", "Bob"]);

    await vi.advanceTimersByTimeAsync(RETRY * 3);
    await settle();
    expect(view(c)).toEqual({ A: false, B: false });
    expect(view(a)).toEqual({ B: true, C: false });
    expect(view(b)).toEqual({ A: true, C: false });
    expect(c.send("A", "x")).toBe(false);
  });

  test("closing a mesh shows it disconnected to its peers", async () => {
    const { a, b, c } = await trio();
    c.close();
    await settle();
    expect(view(a)).toEqual({ B: true, C: false });
    expect(view(b)).toEqual({ A: true, C: false });
  });

  test("device not in knownDevices() is never auto-dialed; known ones are, never self", async () => {
    const known = new Set<string>(["A"]);
    const a = founder("A", "Ann", { knownDevices: () => known });
    await pair(a, "B", "Bob");
    const base = net.created("A");

    await vi.advanceTimersByTimeAsync(RETRY * 3);
    await settle();
    expect(net.created("A")).toBe(base);

    known.add("Z");
    await vi.advanceTimersByTimeAsync(RETRY);
    await settle();
    expect(net.created("A")).toBe(base + 1);
  });

  test("lower deviceId dials; higher waits", async () => {
    const a = founder("A", "Ann", { knownDevices: () => new Set(["0"]) });
    await pair(a, "B", "Bob");
    const base = net.created("A");
    await vi.advanceTimersByTimeAsync(RETRY * 2);
    await settle();
    expect(net.created("A")).toBe(base);
  });

  test("re-paired device: simultaneous intro dial and retry dial keep exactly one link", async () => {
    const all = () => new Set(["A", "B", "C"]);
    const a = founder("A", "Ann", { knownDevices: all });
    const { mesh: b } = await pair(a, "B", "Bob", { knownDevices: all });
    const { mesh: c } = await pair(a, "C", "Cat", { knownDevices: all });
    const cChanges: Record<string, boolean>[] = [];
    c.onPeerChange((p) =>
      cChanges.push(Object.fromEntries(p.map((x) => [x.deviceId, x.connected]))),
    );

    // B reloads: a fresh mesh re-pairs with A while C is still "seen" by B's record log.
    b.close();
    await settle();
    expect(view(c).B).toBe(false);
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob2", { knownDevices: all }));
    const b2 = track(j.mesh);
    vi.advanceTimersByTime(RETRY - 1);
    const cBefore = net.created("C");
    const bBefore = net.created("B");
    await invite.accept(j.answer);
    // A introduces B to C (C offers) while B's retry tick dials C (B < C) at the same time.
    vi.advanceTimersByTime(1);
    await settle();

    expect(net.created("B")).toBe(bBefore + 2); // its retry dial + its answer to C's intro offer
    expect(net.created("C")).toBe(cBefore + 2); // its intro dial + its answer to B's dial
    expect(net.liveLinks("B")).toEqual(["A", "C"]);
    expect(net.liveLinks("C")).toEqual(["A", "B"]);
    expect(view(b2)).toEqual({ A: true, C: true });
    expect(view(c)).toEqual({ A: true, B: true });
    const afterUp = cChanges.slice(cChanges.findIndex((v) => v.B));
    expect(afterUp.every((v) => v.B)).toBe(true);

    const got: unknown[] = [];
    b2.onMessage((from, msg) => got.push([from, msg]));
    c.send("B", "one");
    await settle();
    expect(got).toEqual([["C", "one"]]);
  });
});

/** Count connected→disconnected transitions of `peerId` seen by `m`'s subscribers. */
function dropsOf(m: Mesh, peerId: string): () => number {
  let last = m.peers().find((p) => p.deviceId === peerId)?.connected;
  let drops = 0;
  m.onPeerChange((peers) => {
    const now = peers.find((p) => p.deviceId === peerId)?.connected;
    if (last === true && now === false) drops++;
    last = now;
  });
  return () => drops;
}

describe("one-sided failure", () => {
  test("only B notices B–C died: B redials, C swaps to the newer link without flapping", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const { mesh: c } = await pair(a, "C", "Cat"); // B offered the B–C link (intro)
    const bDrops = dropsOf(b, "C");
    const cDrops = dropsOf(c, "B");

    net.fail("B", "C");
    await settle();
    expect(view(b)).toEqual({ A: true, C: false });
    expect(view(c)).toEqual({ A: true, B: true }); // stale, C has not noticed

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(RETRY);
      await settle();
    }
    expect(view(b)).toEqual({ A: true, C: true });
    expect(view(c)).toEqual({ A: true, B: true });
    expect(bDrops()).toBe(1);
    expect(cDrops()).toBe(0);
    expect(net.liveLinks("B")).toEqual(["A", "C"]);
    expect(net.liveLinks("C")).toEqual(["A", "B"]); // stale link closed, new one kept

    const atB: unknown[] = [];
    const atC: unknown[] = [];
    b.onMessage((from, msg) => atB.push([from, msg]));
    c.onMessage((from, msg) => atC.push([from, msg]));
    c.send("B", "c→b");
    b.send("C", "b→c");
    await settle();
    expect(atB).toEqual([["C", "c→b"]]);
    expect(atC).toEqual([["B", "b→c"]]);
  });

  test("a fresh QR re-pair wins over the inviter's stale link to the same device", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    const { mesh: c } = await pair(a, "C", "Cat"); // B offered the B–C link (intro)
    // B's page reloads: its links die without C noticing; C keeps a stale, silent link to B,
    // which the duplicate rule would otherwise prefer (lower offerer id).
    net.fail("B", "C");
    net.fail("B", "A");
    b.close();
    await settle();
    expect(view(c)).toEqual({ A: true, B: true });

    const { mesh: b2 } = await pair(c, "B", "Bob");
    expect(view(b2)).toEqual({ C: true });
    expect(view(c)).toEqual({ A: true, B: true });
    const atB: unknown[] = [];
    b2.onMessage((from, msg) => atB.push([from, msg]));
    expect(c.send("B", "hi")).toBe(true);
    await settle();
    expect(atB).toEqual([["C", "hi"]]);
  });
});

describe("robustness", () => {
  test("ICE gathering stalls with a host candidate: invite proceeds after 5 s", async () => {
    const a = founder();
    net.setGathering("A", "stall");
    let invite: Awaited<ReturnType<Mesh["createInvite"]>> | undefined;
    void a.createInvite().then((i) => (invite = i));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(invite).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(invite?.payload).toMatch(/^OC2:/);
  });

  test("ICE gathering finds no address: createInvite and join fail clearly", async () => {
    const a = founder();
    const invite = await a.createInvite();
    net.setGathering("A", "stall-empty");
    net.setGathering("B", "stall-empty");
    const failedInvite = a.createInvite();
    const failedJoin = Mesh.join(invite.payload, opts("B", "Bob"));
    const results = Promise.allSettled([failedInvite, failedJoin]);
    await vi.advanceTimersByTimeAsync(5_000);
    for (const r of await results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason.message).toBe(NO_ADDRESS);
    }
    expect(net.pending("A")).toBe(1); // only the first, still-valid invite
    expect(net.pending("B")).toBe(0);
  });

  test("answer that cannot be applied → malformed, invite used, connection closed", async () => {
    const plain = net.factoryFor("A");
    const a = founder("A", "Ann", {
      rtc: (config) => {
        const pc = plain(config);
        pc.setRemoteDescription = () => Promise.reject(new Error("bad sdp"));
        return pc;
      },
    });
    const invite = await a.createInvite();
    const j = await Mesh.join(invite.payload, opts("B", "Bob"));
    track(j.mesh);
    await expectPairingError(invite.accept(j.answer), "malformed");
    await expectPairingError(invite.accept(j.answer), "expired");
    expect(net.pending("A")).toBe(0);
  });

  test("invite TTL timers are cleared on cancel and on Mesh.close()", async () => {
    const a = founder();
    const baseline = vi.getTimerCount(); // the retry interval
    const first = await a.createInvite();
    await a.createInvite();
    expect(vi.getTimerCount()).toBe(baseline + 2);
    first.cancel();
    expect(vi.getTimerCount()).toBe(baseline + 1);
    a.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("pending dials are dropped when no peer is left to relay them", async () => {
    const a = founder("A", "Ann", { knownDevices: () => new Set(["Z"]) });
    await pair(a, "B", "Bob");
    await vi.advanceTimersByTimeAsync(RETRY);
    await settle();
    expect(net.pending("A")).toBe(1); // dial to Z, unanswerable
    net.cut("A", "B");
    await settle();
    expect(net.pending("A")).toBe(0);
  });

  test("a throwing subscriber cannot break the mesh or other subscribers", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = founder();
    a.onPeerChange(() => {
      throw new Error("boom");
    });
    const seen: number[] = [];
    a.onPeerChange((p) => seen.push(p.length));
    const { mesh: b } = await pair(a, "B", "Bob");
    b.onMessage(() => {
      throw new Error("boom");
    });
    const got: unknown[] = [];
    b.onMessage((_, msg) => got.push(msg));
    a.send("B", "x");
    await settle();
    expect(seen).toEqual([1]);
    expect(view(a)).toEqual({ B: true });
    expect(got).toEqual(["x"]);
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});

describe("joining with sync", () => {
  test("app messages sent before the joiner subscribes reach its first subscriber, in order", async () => {
    const a = founder();
    const { mesh: b } = await pair(a, "B", "Bob");
    a.send("B", 1);
    a.send("B", 2);
    await settle();
    const got: unknown[] = [];
    b.onMessage((_from, msg) => got.push(msg));
    a.send("B", 3);
    await settle();
    expect(got).toEqual([1, 2, 3]);
  });

  function memStore(initial: LogRecord[]): StoreLike & { recs: Map<string, LogRecord> } {
    const recs = new Map(initial.map((r) => [`${r.deviceId}:${r.seq}`, r]));
    return {
      recs,
      sessionId: SID,
      put: async (rs) => {
        const fresh = rs.filter((r) => !recs.has(`${r.deviceId}:${r.seq}`));
        for (const r of fresh) recs.set(`${r.deviceId}:${r.seq}`, r);
        return fresh;
      },
      since: async (v) => missingFor(recs.values(), v),
      vector: async () => vectorOf(recs.values()),
    };
  }

  test("records from both sides are exchanged at connect, before any 10 s sync tick", async () => {
    const body = { type: "patron-started", patron: "P" } as const;
    const [ra, rb] = [dev("a"), dev("b")];
    const atA = memStore([mk(ra, 1, body)]);
    const atB = memStore([mk(ra, 1, body), mk(rb, 1, body), mk(rb, 2, body)]);
    const a = founder();
    const syncA = new SyncEngine({ mesh: a, store: atA, onRecords: () => {} });
    syncA.start();
    // B re-pairs: its mesh connects first and the app attaches sync to it afterwards, so
    // A's connect-time vector arrives before B is listening.
    const { mesh: b } = await pair(a, "B", "Bob");
    await settle();
    const syncB = new SyncEngine({ mesh: b, store: atB, onRecords: () => {} });
    syncB.start();
    await settle();
    try {
      const all = [`${ra}:1`, `${rb}:1`, `${rb}:2`];
      expect([...atA.recs.keys()].sort()).toEqual(all);
      expect([...atB.recs.keys()].sort()).toEqual(all);
    } finally {
      syncA.stop();
      syncB.stop();
    }
  });

  test("cancelling an accepted invite that never connected closes its connection", async () => {
    const a = founder();
    const invite = await a.createInvite();
    const other = await a.createInvite();
    // An answer to a different offer: accepted, but the connection never opens.
    const j = await Mesh.join(other.payload, opts("B", "Bob"));
    track(j.mesh);
    const accepting = invite.accept(j.answer);
    await settle();
    const before = net.pending("A");
    invite.cancel();
    await expectPairingError(accepting, "expired");
    expect(net.pending("A")).toBe(before - 1);
  });

  test("cancelling a connected invite leaves the peer connected", async () => {
    const a = founder();
    const { invite } = await pair(a, "B", "Bob");
    invite.cancel();
    await settle();
    expect(view(a)).toEqual({ B: true });
  });
});
