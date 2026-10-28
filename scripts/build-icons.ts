// Renders the icon SVGs in icons/ to the PNG and .ico files the app and the Windows zip use.
// Run after changing an icon SVG, and commit the results: node scripts/build-icons.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { buildIco } from "./ico.ts";

const ROOT = resolve(import.meta.dirname, "..");
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 256];

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svgFile: string, size: number): Promise<Buffer> {
  const svg = readFileSync(resolve(ROOT, "icons", svgFile), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true });
}

async function writeIco(svgFile: string, out: string): Promise<void> {
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(svgFile, size) });
  writeFileSync(resolve(ROOT, out), buildIco(images));
  console.log(`Wrote ${out}`);
}

await writeIco("icon-round.svg", "windows/offline-checkout.ico");
await writeIco("icon-round-printer.svg", "windows/offline-checkout-printer.ico");
writeFileSync(resolve(ROOT, "icons/apple-touch-icon.png"), await render("icon.svg", 180));
console.log("Wrote icons/apple-touch-icon.png");

await browser.close();
