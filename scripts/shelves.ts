// Draws the shelf theme backgrounds: one book per Evergreen Indiana library, spine width from the
// square root of the 2020 population served including contracts (Indiana State Library 2025
// statistics, Table 1). The build regenerates them only when the CSV or this file changes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite-plus";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "src/ui/backgrounds");
export const CSV_FILE = resolve(DIR, "evergreen_indiana_population.csv");
export const HASH_FILE = resolve(DIR, "shelves.sha256");

const W = 2560;
const H = 1440;
const SERIF = "Georgia, 'Times New Roman', 'Liberation Serif', serif";

interface Palette {
  wall: string;
  wall2: string;
  board: string;
  board2: string;
  shade: number;
  books: string[];
  text: string[];
  band: string;
}

export const SHELVES: Record<"shelf-dark" | "shelf-light", Palette> = {
  "shelf-dark": {
    wall: "#2a1a12",
    wall2: "#180e09",
    board: "#8a5a2f",
    board2: "#5a371a",
    shade: 0.34,
    books: [
      "#6e1f24",
      "#22452f",
      "#1f3555",
      "#8c6420",
      "#3c2a4e",
      "#7a3b1c",
      "#2d4f57",
      "#4b1a2b",
      "#5d5a2a",
      "#a24a26",
    ],
    text: ["#f2e3bd", "#ead6a4"],
    band: "#d8b56a",
  },
  "shelf-light": {
    wall: "#efe6d6",
    wall2: "#f8f3ea",
    board: "#d6b48a",
    board2: "#b08a5c",
    shade: 0.16,
    books: [
      "#d4a39e",
      "#a9c0a4",
      "#a9bdd2",
      "#e0c58c",
      "#bfb2cf",
      "#d9a888",
      "#a3c4c2",
      "#c9a5b3",
      "#c8c49a",
      "#e6b596",
    ],
    text: ["#2b2118", "#3a2b1e"],
    band: "#6b4e2a",
  },
};

const SHELF_COUNT = 4;
const MIN_WIDTH = 26;
const SEED = 11;

/**
 * Python's random.Random (MT19937 seeded from an int), so the shelves match the approved drafts,
 * which were drawn in Python. Only the calls the layout makes are here.
 */
export class PyRandom {
  private mt = new Uint32Array(624);
  private i = 625;

  constructor(seed: number) {
    const mt = this.mt;
    mt[0] = 19650218;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = Math.imul(1812433253, p) + i;
    }
    // init_by_array with the one-word key [seed].
    let i = 1;
    for (let k = 624; k > 0; k--) {
      const p = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (mt[i]! ^ Math.imul(p, 1664525)) + seed;
      if (++i >= 624) {
        mt[0] = mt[623]!;
        i = 1;
      }
    }
    for (let k = 623; k > 0; k--) {
      const p = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (mt[i]! ^ Math.imul(p, 1566083941)) - i;
      if (++i >= 624) {
        mt[0] = mt[623]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.i = 624;
  }

  private next(): number {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k]! & 0x80000000) | (mt[(k + 1) % 624]! & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = mt[this.i++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random(): number {
    const a = this.next() >>> 5;
    const b = this.next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** randrange(n), for n below 2**32. */
  below(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.next() >>> (32 - k);
    while (r >= n) r = this.next() >>> (32 - k);
    return r;
  }

  choice<T>(items: readonly T[]): T {
    return items[this.below(items.length)]!;
  }
}

/** Python 3.12+'s sum() of floats, which compensates for rounding. */
export function pySum(values: number[]): number {
  let sum = 0;
  let c = 0;
  for (const x of values) {
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return c && Number.isFinite(c) ? sum + c : sum;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ""])));
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f1 = (n: number) => n.toFixed(1);

function wrap(name: string): string[] {
  const words = name.split(" ");
  let best: [string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) {
      best = [a, b];
    }
  }
  return best ?? [name];
}

function spineText(name: string, x: number, y: number, bw: number, bh: number, fill: string) {
  const avail = bh - 62;
  let fs = -Infinity;
  let lines: string[] = [];
  for (const cand of [[name], wrap(name)]) {
    const longest = Math.max(...cand.map((l) => l.length));
    // 0.55em per character allows for Georgia, which is wider than most fallback serifs.
    const size = Math.min((bw - 6) / (cand.length * 1.16), avail / (0.55 * longest), 40);
    if (size > fs) [fs, lines] = [size, cand];
  }
  let extra = "";
  if (fs < 11) {
    fs = Math.min((bw - 4) / 1.12, 11);
    lines = [name];
    if (name.length * 0.55 * fs > avail) {
      extra = ` textLength="${avail.toFixed(0)}" lengthAdjust="spacingAndGlyphs"`;
    }
  }
  const cx = x + bw / 2;
  const cy = y + bh / 2;
  const step = fs * 1.14;
  return lines
    .map((line, i) => {
      const offset = (i - (lines.length - 1) / 2) * step;
      // rotate(90) turns the text's "down" to screen left, so later lines sit further left, as on a real spine.
      return (
        `<text transform="translate(${f1(cx - offset)} ${f1(cy)}) rotate(90)" dy=".35em" ` +
        `text-anchor="middle" font-size="${f1(fs)}" fill="${fill}"${extra}>${escape(line)}</text>`
      );
    })
    .join("");
}

export function drawShelf(csv: string, id: string, pal: Palette): string {
  const rows = parseCsv(csv).map((r) => ({
    name: r.library_catalog_name!,
    people: Number(r.population_2020_with_contracts),
  }));
  const margin = 40;
  const boardH = 26;
  const inner = W - 2 * margin;
  const weights = rows.map((r) => Math.sqrt(r.people));
  const k = (SHELF_COUNT * inner - rows.length * MIN_WIDTH) / pySum(weights);
  const widths = weights.map((w) => MIN_WIDTH + k * w);

  // Fill shelves in order, moving on once a book would sit mostly past the shelf's share.
  const groups: number[][] = [];
  let cur: number[] = [];
  let cum = 0;
  widths.forEach((b, i) => {
    if (
      cur.length &&
      cum + b / 2 > inner * (groups.length + 1) &&
      SHELF_COUNT - groups.length > 1
    ) {
      groups.push(cur);
      cur = [];
    }
    cur.push(i);
    cum += b;
  });
  groups.push(cur);
  const fit = groups.map((g) => inner / pySum(g.map((i) => widths[i]!)));

  const rng = new PyRandom(SEED);
  const bay = (H - 2 * 24) / SHELF_COUNT;
  const p = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" ` +
      `role="img" aria-label="Bookshelf of 139 Evergreen Indiana libraries, spine width based on population served" ` +
      `font-family="${SERIF}">`,
    `<defs>` +
      `<linearGradient id="${id}-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.wall2}"/><stop offset="1" stop-color="${pal.wall}"/></linearGradient>` +
      `<linearGradient id="${id}-board" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.board}"/><stop offset="1" stop-color="${pal.board2}"/></linearGradient>` +
      `<linearGradient id="${id}-round" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".18" stop-color="#fff" stop-opacity=".13"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>` +
      `<linearGradient id="${id}-under" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="${Math.max(pal.shade, 0.07)}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
      `</defs>`,
    `<rect width="${W}" height="${H}" fill="url(#${id}-wall)"/>`,
  ];
  let last: string | null = null;
  const gap = 1.5;
  groups.forEach((group, s) => {
    const top = 24 + s * bay;
    const floor = top + bay - boardH;
    const maxH = bay - boardH - 42;
    p.push(`<rect x="0" y="${f1(top)}" width="${W}" height="46" fill="url(#${id}-under)"/>`);
    let x = margin;
    for (const i of group) {
      const { name, people } = rows[i]!;
      const bw = widths[i]! * fit[s]!;
      const bh = maxH * rng.uniform(0.86, 1.0);
      const y = floor - bh;
      const color = rng.choice(pal.books.filter((c) => c !== last));
      last = color;
      const ink = rng.choice(pal.text);
      const rect = (by: number, h: number | string, extra: string) =>
        `<rect x="${f1(x)}" y="${f1(by)}" width="${f1(bw - gap)}" height="${h}"${extra}/>`;
      p.push(`<g><title>${escape(name)}: ${people.toLocaleString("en-US")}</title>`);
      p.push(rect(y, f1(bh), ` rx="2.5" fill="${color}"`));
      const style = rng.below(3);
      if (style === 0) {
        for (const by of [y + 14, y + bh - 20])
          p.push(rect(by, 5, ` fill="${pal.band}" opacity=".75"`));
      } else if (style === 1) {
        for (const by of [y + 10, y + 19, y + bh - 14, y + bh - 23]) {
          p.push(rect(by, 2, ` fill="${pal.band}" opacity=".65"`));
        }
      } else {
        for (const [by, h] of [
          [y + 11, 7],
          [y + 22, 2],
          [y + bh - 18, 7],
          [y + bh - 24, 2],
        ] as const) {
          p.push(rect(by, h, ` fill="${pal.band}" opacity=".72"`));
        }
      }
      const shade = Math.min(1, (110 / bw) ** 0.6).toFixed(2);
      p.push(rect(y, f1(bh), ` rx="2.5" fill="url(#${id}-round)" opacity="${shade}"`));
      p.push(spineText(name, x, y, bw - gap, bh, ink));
      p.push("</g>");
      x += bw;
    }
    p.push(
      `<rect x="0" y="${f1(floor)}" width="${W}" height="${boardH}" fill="url(#${id}-board)"/>`,
    );
  });
  p.push("</svg>");
  return p.join("");
}

export function shelvesHash(): string {
  return createHash("sha256")
    .update(readFileSync(CSV_FILE))
    .update(readFileSync(import.meta.filename))
    .digest("hex");
}

/** Redraws the backgrounds when the CSV or this file has changed since the stored hash. */
export function updateShelves(): boolean {
  const hash = shelvesHash();
  if (existsSync(HASH_FILE) && readFileSync(HASH_FILE, "utf8").trim() === hash) return false;
  const csv = readFileSync(CSV_FILE, "utf8");
  for (const [id, pal] of Object.entries(SHELVES)) {
    writeFileSync(resolve(DIR, `${id}.svg`), drawShelf(csv, id, pal));
  }
  writeFileSync(HASH_FILE, `${hash}\n`);
  return true;
}

export function shelves(): Plugin {
  return {
    name: "shelves",
    buildStart() {
      if (updateShelves()) this.info("Redrew the shelf theme backgrounds");
    },
  };
}
