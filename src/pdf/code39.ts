import JsBarcode from "jsbarcode";
import { CODE39_TEXT } from "../log/barcode";

export const NARROW_IN = 0.0075;
export const QUIET_MODULES = 10;

const cache = new Map<string, string>();

/** Bar/space pattern ("1" bar, "0" space) for Code 39 incl. start/stop `*`, no check digit. Wide:narrow is 3:1. */
export function code39Modules(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  if (!CODE39_TEXT.test(text)) throw new Error(`Not a Code 39 string: ${JSON.stringify(text)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target: any = {};
  JsBarcode(target, text, { format: "CODE39", mod43: false } as JsBarcode.BaseOptions);
  const encodings: { data: string }[] = target.encodings ?? [];
  // JsBarcode appends the inter-character narrow space after every character, the stop included;
  // drop it so the pattern is exactly 16 modules per character minus 1 (the gap joins the quiet zone).
  const modules = encodings
    .map((e) => e.data)
    .join("")
    .replace(/0$/, "");
  if (!modules) throw new Error(`Cannot encode as Code 39: ${text}`);
  cache.set(text, modules);
  return modules;
}

/** Width in inches including a quiet zone on each side. */
export function code39Width(text: string): number {
  return (code39Modules(text).length + 2 * QUIET_MODULES) * NARROW_IN;
}
