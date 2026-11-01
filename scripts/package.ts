// Zips the built app with the Windows, macOS and Linux setup scripts for a release download.
// Run after `npm run build`: node scripts/package.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

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

const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const locals: Buffer[] = [];
const centrals: Buffer[] = [];
let offset = 0;
for (const { name, data, executable } of files) {
  const nameBuf = Buffer.from(name, "ascii");
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  // Made by Unix, so unzip, Archive Utility and Linux file managers keep the execute bit.
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(((executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += local.length + nameBuf.length + packed.length;
}

const centralDir = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDir.length, 12);
end.writeUInt32LE(offset, 16);

writeFileSync(OUT, Buffer.concat([...locals, centralDir, end]));
console.log(`Wrote ${OUT}`);
