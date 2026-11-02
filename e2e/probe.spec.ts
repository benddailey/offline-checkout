import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { launchChromium } from "./helpers/app";

const probeUrl = pathToFileURL(resolve(process.cwd(), "dist-probe", "probe.html")).href;

test("probe: IndexedDB passes and two pages connect over pasted codes", async () => {
  const browser = await launchChromium();
  try {
    const host = await (await browser.newContext()).newPage();
    const guest = await (await browser.newContext()).newPage();
    await host.goto(probeUrl);
    await guest.goto(probeUrl);

    for (const page of [host, guest]) {
      await expect(page.getByTestId("idb-status")).toHaveText("PASS");
    }

    await host.getByRole("button", { name: "I am PC A (Host)" }).click();
    const offer = await host.getByTestId("rtc-offer").locator("textarea").inputValue();
    expect(offer).toMatch(/^OC3:/);

    await guest.getByRole("button", { name: "I am PC B (Guest)" }).click();
    const offerIn = guest.getByTestId("rtc-offer-in");
    await offerIn.getByLabel("Pasted code").fill(offer);
    await offerIn.getByRole("button", { name: "Use pasted code" }).click();
    const answer = await guest.getByTestId("rtc-answer").locator("textarea").inputValue();
    expect(answer).toMatch(/^OC3:/);

    const answerIn = host.getByTestId("rtc-answer-in");
    await answerIn.getByLabel("Pasted code").fill(answer);
    await answerIn.getByRole("button", { name: "Use pasted code" }).click();

    await expect(host.getByTestId("rtc-status")).toHaveText("PASS", { timeout: 25_000 });
    await expect(host.getByTestId("rtc-rtt")).toHaveText(/Round trip: \d+ ms/);
    await expect(guest.getByTestId("rtc-status")).toHaveText("PASS");
    await expect(host.getByTestId("rtc-candidates")).toContainText("host");

    // The copyable summary reflects the checks.
    const summary = await host.locator("#results-text").inputValue();
    expect(summary).toContain("IndexedDB: PASS");
    expect(summary).toMatch(/WebRTC \(host\): PASS - round trip \d+ ms/);
  } finally {
    await browser.close();
  }
});

// Holds "Preparing the code..." for a second so a click lands before the offer is ready.
async function slowHostPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    const proto = RTCPeerConnection.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, "setLocalDescription")!.value as (
      this: RTCPeerConnection,
      d?: RTCLocalSessionDescriptionInit,
    ) => Promise<void>;
    proto.setLocalDescription = async function (d?: RTCLocalSessionDescriptionInit) {
      await set.call(this, d);
      await new Promise((r) => setTimeout(r, 1_000));
    };
  });
  await page.goto(probeUrl);
  return page;
}

test("probe: Start over while the Host code is being prepared leaves the test not run", async () => {
  const browser = await launchChromium();
  try {
    const page = await slowHostPage(browser);
    await page.getByRole("button", { name: "I am PC A (Host)" }).click();
    await page.getByRole("button", { name: "Start over" }).click();
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("rtc-status")).toHaveText("NOT RUN");
    await expect(page.getByTestId("rtc-detail")).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test("probe: pressing Host twice shows one working code", async () => {
  const browser = await launchChromium();
  try {
    const page = await slowHostPage(browser);
    const hostButton = page.getByRole("button", { name: "I am PC A (Host)" });
    await hostButton.click();
    await hostButton.click();
    await expect(page.getByTestId("rtc-offer").locator("textarea")).toHaveValue(/^OC3:/);
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("rtc-status")).toHaveText("RUNNING...");
    await expect(page.getByTestId("rtc-detail")).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test("probe: a camera that fails on a second test hides the earlier scanner", async () => {
  const browser = await launchChromium();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(probeUrl);
    const camera = page.getByTestId("camera");
    await camera.getByRole("button", { name: "Test camera" }).click();
    await expect(camera.getByText("Reads a QR code:")).toBeVisible();

    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await camera.getByRole("button", { name: "Test camera" }).click();
    await expect(camera.getByText("The camera could not be used from this page.")).toBeVisible();
    await expect(camera.getByText("Reads a QR code:")).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
