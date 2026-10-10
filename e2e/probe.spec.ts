import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
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
    expect(offer).toMatch(/^OC1:/);

    await guest.getByRole("button", { name: "I am PC B (Guest)" }).click();
    const offerIn = guest.getByTestId("rtc-offer-in");
    await offerIn.getByLabel("Pasted code").fill(offer);
    await offerIn.getByRole("button", { name: "Use pasted code" }).click();
    const answer = await guest.getByTestId("rtc-answer").locator("textarea").inputValue();
    expect(answer).toMatch(/^OC1:/);

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
