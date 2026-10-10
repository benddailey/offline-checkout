import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "@playwright/test";

export const CHROMIUM_ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

export function appUrl(): string {
  return pathToFileURL(resolve(process.cwd(), "dist", "offline-checkout.html")).href;
}

export function launchChromium(extraArgs: string[] = []): Promise<Browser> {
  return chromium.launch({ headless: false, args: [...CHROMIUM_ARGS, ...extraArgs] });
}
