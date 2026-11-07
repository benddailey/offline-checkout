// Completes Vite's bundled-license file and embeds it, after the app's own notice, in the built HTML.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";
import { PHOTO_BASE, PHOTOS } from "../src/ui/backgrounds/photos";

const ROOT = resolve(import.meta.dirname, "..");
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

const APP_NOTICE = `Copyright (C) 2026 Ben Dailey
Free software under the GNU Affero General Public License, version 3 or (at your option) any later
version: https://www.gnu.org/licenses/agpl-3.0.html
Source code: https://github.com/benddailey/offline-checkout`;

/** Fills sections Vite left empty because the package's license file is not named LICENSE*. */
export function fillEmptySections(
  md: string,
  licenseOf: (pkg: string) => string | undefined,
): string {
  return md
    .split(/^(?=## )/m)
    .map((part) => {
      const heading = /^## (\S+) - .*\n?/.exec(part);
      if (!heading || part.slice(heading[0].length).trim()) return part;
      const text = licenseOf(heading[1]!);
      if (!text) throw new Error(`No license text found for bundled package ${heading[1]}`);
      return `${heading[0].trimEnd()}\n\n${text.trim()}\n\n`;
    })
    .join("");
}

/** An HTML comment holding `text`; dashes are spaced apart because "--" may not appear inside one. */
export function htmlComment(text: string): string {
  return `<!--\n${text.replace(/-(?=-)/g, "- ")}\n-->`;
}

/** Inserts the comment right after the doctype: anything before it would put the page in quirks mode. */
export function embedInHtml(html: string, text: string): string {
  const doctype = /^<!doctype html>\n?/i.exec(html);
  if (!doctype) throw new Error("Built HTML does not start with <!doctype html>");
  return `${doctype[0].trimEnd()}\n${htmlComment(text)}\n${html.slice(doctype[0].length)}`;
}

function packageLicense(pkg: string): string | undefined {
  const dir = resolve(ROOT, "node_modules", pkg);
  if (!existsSync(dir)) return undefined;
  const file = readdirSync(dir).find((f) => /licen[cs]e(\.(md|txt))?$/i.test(f));
  return file && readFileSync(resolve(dir, file), "utf8");
}

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8").trim();
const text = (source: string | Uint8Array) =>
  typeof source === "string" ? source : new TextDecoder().decode(source);

/** Every background photo is credited, public domain ones too. */
export function photoCredits(): string {
  const entries = PHOTOS.map((p) =>
    [
      `### ${p.title}`,
      "",
      `Photo: ${p.author}`,
      `License: ${p.license}${p.licenseUrl ? ` (${p.licenseUrl})` : ""}`,
      `Source: ${p.source}`,
      `Changes: resized to 1920 pixels wide and saved as WebP.`,
    ].join("\n"),
  );
  return `## Background photos\n\nThe photo backgrounds come from Wikimedia Commons. They are not in this file: each PC downloads them once from ${PHOTO_BASE}\n\n${entries.join("\n\n")}`;
}

/** Needs `build.license: { fileName: NOTICES_FILE }`. `title` heads the comment in the HTML. */
export function thirdPartyNotices(title: string): Plugin {
  return {
    name: "third-party-notices",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const notices = bundle[NOTICES_FILE];
        if (notices?.type !== "asset") throw new Error(`Vite did not emit ${NOTICES_FILE}`);
        let md = fillEmptySections(text(notices.source), packageLicense).trimEnd();
        // zxing-wasm's .wasm holds compiled C++ that its npm license metadata does not list.
        if (/^## zxing-wasm - /m.test(md)) {
          md += `\n\n${read("licenses/zxing-wasm-native.md")}\n\n${read("licenses/Apache-2.0.txt")}`;
        }
        md += `\n\n${photoCredits()}`;
        notices.source = `${md}\n`;
        for (const file of Object.values(bundle)) {
          if (file.type === "asset" && file.fileName.endsWith(".html")) {
            file.source = embedInHtml(text(file.source), `${title}\n${APP_NOTICE}\n\n${md}`);
          }
        }
      },
    },
  };
}
