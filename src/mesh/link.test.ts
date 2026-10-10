import { describe, expect, test, vi } from "vite-plus/test";
import { Link } from "./link";

function stubPc() {
  return { close: vi.fn() } as unknown as RTCPeerConnection;
}

describe("Link", () => {
  test("hello hook runs once when the channel is already open and 'open' fires later", async () => {
    const pc = stubPc();
    const open = vi.fn();
    new Link(
      pc,
      { offererId: "A", expectedId: "A", linkId: "1" },
      {
        open,
        message: () => {},
        closed: () => {},
      },
    );
    const channel = {
      label: "oc",
      readyState: "open",
      close: vi.fn(),
    } as unknown as RTCDataChannel;
    pc.ondatachannel!({ channel } as RTCDataChannelEvent);
    channel.onopen!(new Event("open"));
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("duplicate rule: lower offerer wins; same offerer → newer linkId wins", () => {
    const hooks = { open: () => {}, message: () => {}, closed: () => {} };
    const mk = (offererId: string, linkId: string) =>
      new Link(stubPc(), { offererId, expectedId: null, linkId }, hooks);
    expect(Link.compare(mk("A", "2"), mk("B", "1"))).toBeLessThan(0);
    expect(Link.compare(mk("B", "9"), mk("A", "1"))).toBeGreaterThan(0);
    expect(Link.compare(mk("A", "000002"), mk("A", "000001"))).toBeLessThan(0);
    expect(Link.compare(mk("A", "000001"), mk("A", "000002"))).toBeGreaterThan(0);
  });
});
