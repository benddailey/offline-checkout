import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { PHOTO_BASE, PHOTO_SET, PHOTOS } from "../../src/ui/backgrounds/photos";

/** The e2e browsers can't reach GitHub Pages (CHROMIUM_ARGS); tests that want photos serve these. */
const DIR = resolve(process.cwd(), ".cache", PHOTO_SET);
const RELEASE = `https://github.com/benddailey/offline-checkout/releases/download/${PHOTO_SET}/`;

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Downloads the release's photos once per machine into .cache/, checking each hash. */
export async function photoFiles(): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  for (const p of PHOTOS) {
    const file = resolve(DIR, `${p.id}.webp`);
    if (existsSync(file) && hash(readFileSync(file)) === p.sha256) continue;
    const response = await fetch(`${RELEASE}${p.id}.webp`);
    if (!response.ok) throw new Error(`${p.id}.webp: ${response.status} from ${RELEASE}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (hash(bytes) !== p.sha256) throw new Error(`${p.id}.webp does not match its sha256`);
    writeFileSync(file, bytes);
  }
  return DIR;
}

/** Answers the app's photo downloads as GitHub Pages would; `wrong` ids get bytes that fail the hash. */
export async function servePhotos(page: Page, wrong: string[] = []): Promise<void> {
  const dir = await photoFiles();
  await page.route(`${PHOTO_BASE}*`, (route) => {
    const id = /([^/]+)\.webp$/.exec(route.request().url())?.[1] ?? "";
    const headers = { "access-control-allow-origin": "*" };
    if (wrong.includes(id)) return route.fulfill({ body: "not the photo", headers });
    if (!PHOTOS.some((p) => p.id === id)) return route.fulfill({ status: 404, headers });
    return route.fulfill({ path: resolve(dir, `${id}.webp`), contentType: "image/webp", headers });
  });
}
