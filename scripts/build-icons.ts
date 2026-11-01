// Renders the icon SVGs in icons/ to the PNG, .ico and .icns files the app and the setup scripts use.
// Run after changing an icon SVG, and commit the results: node scripts/build-icons.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { ICNS_SIZES, buildIcns } from "./icns.ts";
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

async function writeIcns(svgFile: string, out: string): Promise<void> {
  const images = [];
  for (const size of ICNS_SIZES) images.push({ size, png: await render(svgFile, size) });
  writeFileSync(resolve(ROOT, out), buildIcns(images));
  console.log(`Wrote ${out}`);
}

async function writePng(svgFile: string, size: number, out: string): Promise<void> {
  writeFileSync(resolve(ROOT, out), await render(svgFile, size));
  console.log(`Wrote ${out}`);
}

for (const [svg, name] of [
  ["icon-round.svg", "offline-checkout"],
  ["icon-round-printer.svg", "offline-checkout-printer"],
] as const) {
  await writeIco(svg, `windows/${name}.ico`);
  await writeIcns(svg, `macos/${name}.icns`);
  await writePng(svg, 256, `linux/${name}.png`);
}
await writePng("icon.svg", 180, "icons/apple-touch-icon.png");

await browser.close();
