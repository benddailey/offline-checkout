// Captures real Chromium SDP samples into src/pairing/fixtures.
// Run: node scripts/capture-sdp.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "..", "src", "pairing", "fixtures");

async function capture(args: string[]): Promise<{ offer: string; answer: string }> {
  const browser = await chromium.launch({ headless: true, args });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async () => {
      const gathered = (pc: RTCPeerConnection) =>
        new Promise<void>((done) => {
          if (pc.iceGatheringState === "complete") return done();
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") done();
          });
        });
      const a = new RTCPeerConnection({ iceServers: [] });
      const b = new RTCPeerConnection({ iceServers: [] });
      a.createDataChannel("oc");
      await a.setLocalDescription(await a.createOffer());
      await gathered(a);
      const offer = a.localDescription!.sdp;
      await b.setRemoteDescription({ type: "offer", sdp: offer });
      await b.setLocalDescription(await b.createAnswer());
      await gathered(b);
      const answer = b.localDescription!.sdp;
      a.close();
      b.close();
      return { offer, answer };
    });
  } finally {
    await browser.close();
  }
}

mkdirSync(OUT, { recursive: true });
const variants = {
  ip: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  mdns: [] as string[],
};
for (const [name, args] of Object.entries(variants)) {
  const { offer, answer } = await capture(args);
  writeFileSync(resolve(OUT, `offer-${name}.sdp`), offer);
  writeFileSync(resolve(OUT, `answer-${name}.sdp`), answer);
  console.log(`captured ${name}`);
}
