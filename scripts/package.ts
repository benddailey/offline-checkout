// Zips the built app with the Windows, macOS and Linux setup scripts for a release download.
// Run after `npm run build`: node scripts/package.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";

const ROOT = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const OUT = resolve(ROOT, "dist", `offline-checkout-v${version}.zip`);

const now = new Date();
const crlf = (text: string) => Buffer.from(text.replace(/\r?\n/g, "\r\n"));
const lf = (text: string) => Buffer.from(text.replace(/\r\n/g, "\n"));
const read = (...path: string[]) => readFileSync(resolve(ROOT, ...path));
const readText = (...path: string[]) => readFileSync(resolve(ROOT, ...path), "utf8");

/** README.md as Notepad-friendly text: headings underlined, bold, code and link markup removed. */
function readmeText(md: string): string {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const lines = [`Offline Checkout version ${version} (${today})`, ""];
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("Developers:")) continue;
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const text = (heading ? heading[2]! : line)
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) =>
        label === url ? url : `${label} (${url})`,
      );
    lines.push(text);
    if (heading) lines.push((heading[1] === "#" ? "=" : "-").repeat(text.length));
  }
  return lines.join("\n").trimEnd() + "\n";
}

const files: { name: string; data: Buffer; executable?: boolean }[] = [
  { name: "offline-checkout.html", data: read("dist", "offline-checkout.html") },
  // cmd.exe needs CRLF and bash needs LF, whatever the checkout did.
  {
    name: "Windows - Create shortcuts.cmd",
    data: crlf(readText("windows", "Create shortcuts.cmd")),
  },
  {
    name: "Mac - Create shortcuts.command",
    data: lf(readText("macos", "Create shortcuts.command")),
    executable: true,
  },
  {
    name: "Linux - Create shortcuts.sh",
    data: lf(readText("linux", "Create shortcuts.sh")),
    executable: true,
  },
  ...["offline-checkout", "offline-checkout-printer"].flatMap((icon) => [
    { name: `icons/${icon}.ico`, data: read("windows", `${icon}.ico`) },
    { name: `icons/${icon}.icns`, data: read("macos", `${icon}.icns`) },
    { name: `icons/${icon}.png`, data: read("linux", `${icon}.png`) },
  ]),
  { name: "README.txt", data: crlf(readmeText(readText("README.md"))) },
  { name: "LICENSE.txt", data: crlf(readText("LICENSE")) },
  { name: "THIRD-PARTY-NOTICES.txt", data: crlf(readText("dist", "THIRD-PARTY-NOTICES.md")) },
];

// Made by Unix (os 3), so unzip, Archive Utility and Linux file managers keep the execute bit.
const entries = files.map(({ name, data, executable }) => [
  name,
  [data, { level: 9, os: 3, attrs: (executable ? 0o100755 : 0o100644) << 16, mtime: now }],
]);
writeFileSync(OUT, zipSync(Object.fromEntries(entries)));
console.log(`Wrote ${OUT}`);
