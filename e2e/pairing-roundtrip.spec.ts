import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { build } from "vite-plus";
import { launchChromium } from "./helpers/app";

/** Bundle src/pairing/index.ts into an IIFE exposing `window.Pairing`. */
async function bundlePairing(): Promise<string> {
  const out = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(process.cwd(), "src/pairing/index.ts"),
        formats: ["iife"],
        name: "Pairing",
        fileName: "pairing",
      },
    },
  });
  const result = Array.isArray(out) ? out[0]! : out;
  if (!("output" in result)) throw new Error("unexpected build result");
  const chunk = result.output.find((o) => o.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("no chunk emitted");
  return chunk.code;
}

test("minified offer/answer through the QR codec opens a data channel", async () => {
  const code = await bundlePairing();
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const inviter = await context.newPage();
    const joiner = await context.newPage();
    for (const page of [inviter, joiner]) {
      await page.goto("about:blank");
      await page.addScriptTag({ content: code });
    }

    const offerText = await inviter.evaluate(async () => {
      const { minifySdp, encodePayload } = (window as any).Pairing;
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;
      const dc = pc.createDataChannel("oc");
      (window as any).received = new Promise<string>((res) => {
        dc.onmessage = (e) => res(e.data);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((done) => {
        if (pc.iceGatheringState === "complete") return done();
        pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done();
      });
      return encodePayload({
        kind: "offer",
        sessionId: "s1",
        sessionName: "Book Fair",
        deviceId: "dev-a",
        employee: "Ann",
        sdp: minifySdp(pc.localDescription!.sdp),
      });
    });
    expect(offerText.length).toBeLessThanOrEqual(400);

    const answerText = await joiner.evaluate(async (text) => {
      const { decodePayload, encodePayload, minifySdp, rebuildSdp } = (window as any).Pairing;
      const offer = decodePayload(text, "offer");
      const pc = new RTCPeerConnection({ iceServers: [] });
      (window as any).pc = pc;
      (window as any).opened = new Promise<void>((res) => {
        pc.ondatachannel = (e) => {
          const dc = e.channel;
          const open = () => {
            dc.send("ping");
            res();
          };
          if (dc.readyState === "open") open();
          else dc.onopen = open;
        };
      });
      await pc.setRemoteDescription({ type: "offer", sdp: rebuildSdp(offer.sdp, "offer") });
      await pc.setLocalDescription(await pc.createAnswer());
      await new Promise<void>((done) => {
        if (pc.iceGatheringState === "complete") return done();
        pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && done();
      });
      return encodePayload({
        kind: "answer",
        sessionId: offer.sessionId,
        sessionName: offer.sessionName,
        deviceId: "dev-b",
        employee: "Bob",
        sdp: minifySdp(pc.localDescription!.sdp),
      });
    }, offerText);

    await inviter.evaluate(async (text) => {
      const { decodePayload, rebuildSdp } = (window as any).Pairing;
      const answer = decodePayload(text, "answer");
      await (window as any).pc.setRemoteDescription({
        type: "answer",
        sdp: rebuildSdp(answer.sdp, "answer"),
      });
    }, answerText);

    expect(await inviter.evaluate(() => (window as any).received)).toBe("ping");
    await joiner.evaluate(() => (window as any).opened);
  } finally {
    await browser.close();
  }
});
