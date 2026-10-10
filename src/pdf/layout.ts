import type { Block } from "./blocks";
import { code39Width } from "./code39";

export const GEOMETRY = {
  pageW: 8.5,
  pageH: 11,
  margin: 0.5,
  headerH: 0.45,
  gutter: 0.25,
  barH: 0.25,
  textH: 0.12,
  patronRowH: 0.55,
  itemRowH: 0.4,
  captionH: 0.2,
  boxPad: 0.08,
  blockGap: 0.15,
} as const;

/** Height of one summary line in inches. */
export const SUMMARY_LINE_H = 0.2;

/**
 * Coordinates are inches from the page's top-left. `page` is 1-based.
 * A barcode's (x, y) is the top-left of its bar area including quiet zones, width code39Width(text);
 * the human-readable text sits below the bars within the row height.
 */
export type Placed =
  | { kind: "page-header"; page: number; text: string }
  | {
      kind: "barcode";
      page: number;
      x: number;
      y: number;
      text: string;
      role: "patron" | "item";
      continued?: boolean;
    }
  | { kind: "box"; page: number; x: number; y: number; w: number; h: number }
  | { kind: "caption"; page: number; x: number; y: number; text: string }
  | { kind: "summary"; page: number; x: number; y: number; lines: string[] };

// Known limits: a summary taller than a column, or a barcode wider than the usable width, overflows.
export function layout(
  blocks: Block[],
  summaryLines: string[],
  g: typeof GEOMETRY = GEOMETRY,
): { columns: number; colW: number; pages: number; elements: Placed[] } {
  const usableW = g.pageW - 2 * g.margin;
  let maxW = 0;
  for (const b of blocks) {
    maxW = Math.max(maxW, code39Width(b.patron));
    for (const i of b.items) maxW = Math.max(maxW, code39Width(i));
  }
  const columns =
    maxW === 0 ? 1 : Math.max(1, Math.floor((usableW + g.gutter) / (maxW + g.gutter)));
  const colW = (usableW - (columns - 1) * g.gutter) / columns;

  const top = g.margin + g.headerH;
  const bottom = g.pageH - g.margin;
  const colH = bottom - top;
  const elements: Placed[] = [];
  let page = 1;
  let col = 0;
  let y = top;

  const colX = () => g.margin + col * (colW + g.gutter);
  const nextColumn = () => {
    col++;
    if (col >= columns) {
      col = 0;
      page++;
    }
    y = top;
  };
  const remaining = () => bottom - y;
  const overhead = g.patronRowH + 2 * g.boxPad + g.captionH;
  const heightFor = (n: number) => overhead + n * g.itemRowH;
  const EPS = 1e-9;

  for (const b of blocks) {
    const caption = `${b.items.length} item${b.items.length === 1 ? "" : "s"} · ${b.clerks.join(", ")}`;
    const fullH = heightFor(b.items.length);
    let placed = 0;
    let continued = false;
    do {
      // Whole block moves to the next column unless it is taller than a full column.
      const need = fullH <= colH ? fullH : heightFor(Math.min(1, b.items.length - placed));
      if (remaining() + EPS < need) nextColumn();
      const fit = Math.floor((remaining() - overhead + EPS) / g.itemRowH);
      const count = Math.min(b.items.length - placed, fit);
      const x = colX();
      elements.push({
        kind: "barcode",
        page,
        x,
        y,
        text: b.patron,
        role: "patron",
        ...(continued ? { continued: true } : {}),
      });
      const boxY = y + g.patronRowH;
      const boxH = 2 * g.boxPad + count * g.itemRowH;
      elements.push({ kind: "box", page, x, y: boxY, w: colW, h: boxH });
      for (let i = 0; i < count; i++) {
        elements.push({
          kind: "barcode",
          page,
          x,
          y: boxY + g.boxPad + i * g.itemRowH,
          text: b.items[placed + i],
          role: "item",
        });
      }
      elements.push({ kind: "caption", page, x, y: boxY + boxH, text: caption });
      y = boxY + boxH + g.captionH;
      placed += count;
      continued = true;
      if (placed < b.items.length) nextColumn();
    } while (placed < b.items.length);
    y += g.blockGap;
  }

  const summaryH = summaryLines.length * SUMMARY_LINE_H;
  if (blocks.length > 0 && remaining() + EPS < summaryH && y > top) nextColumn();
  elements.push({ kind: "summary", page, x: colX(), y, lines: summaryLines });

  for (let p = 1; p <= page; p++) elements.push({ kind: "page-header", page: p, text: "" });
  return { columns, colW, pages: page, elements };
}
