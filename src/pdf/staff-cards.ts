import { barcodeWidth } from "./layout";

/** Avery 5371: letter, 2 × 5 cards of 3.5" × 2", 0.75" side and 0.5" top margins, no gutters. */
export const AVERY_5371 = {
  cols: 2,
  rows: 5,
  cardW: 3.5,
  cardH: 2,
  left: 0.75,
  top: 0.5,
} as const;

export const CARD_COUNT = AVERY_5371.cols * AVERY_5371.rows;

/** 1/75": every bar is a whole number of dots at 300 and 600 dpi. */
export const STAFF_MODULE_IN = 1 / 75;

/** Room for the bars (quiet zones included) inside the card's side padding. */
export const STAFF_BAR_MAX_W = AVERY_5371.cardW - 0.3;

/** Top-left of card `i` (0-based), filled left to right, then top to bottom. */
export function cardOrigin(i: number): { x: number; y: number } {
  const g = AVERY_5371;
  return {
    x: g.left + (i % g.cols) * g.cardW,
    y: g.top + Math.floor(i / g.cols) * g.cardH,
  };
}

/** Values are taken as typed apart from surrounding whitespace: case is never changed. */
export function staffValue(raw: string): string {
  return raw.trim();
}

/** Printable ASCII only: Code 128 has no other characters, and jsPDF's fonts print them all. */
const NOT_PRINTABLE = /[^\x20-\x7e]/gu;

export function staffCardError(raw: string): string | null {
  const v = staffValue(raw);
  if (v === "") return null;
  const bad = [...new Set(v.match(NOT_PRINTABLE))];
  if (bad.length > 0) {
    return `Can't go in a barcode: ${bad.map((c) => `"${c}"`).join(", ")}`;
  }
  if (barcodeWidth(v, STAFF_MODULE_IN) > STAFF_BAR_MAX_W) return "Too long to fit on the card";
  return null;
}

/** Copies box `i` into every box after it. */
export function fillRest(values: readonly string[], i: number): string[] {
  return values.map((v, j) => (j > i ? values[i]! : v));
}
