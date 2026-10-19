import JsBarcode from "jsbarcode";
import { RECEIPT_WIDTH_MM } from "./print";

/** One printer dot at 203 dpi. */
export const DOT_MM = 25.4 / 203;
/** One narrow bar: exactly 2 printer dots. */
export const MODULE_MM = 2 * DOT_MM;
export const QUIET_MODULES = 10;

/** Left edge of every barcode, in whole printer dots from the paper's left edge, so bars land on dots. */
export const BAR_LEFT_DOTS = 8;

const BAR_UNITS = 100;
const cache = new Map<string, string>();

/** Bar/space pattern ("1" bar, "0" space) incl. start, check and stop; JsBarcode picks code sets A/B/C. */
export function code128Modules(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target: any = {};
  JsBarcode(target, text, { format: "CODE128" });
  const encodings: { data: string }[] = target.encodings ?? [];
  const modules = encodings.map((e) => e.data).join("");
  if (!modules) throw new Error(`Cannot encode as Code 128: ${text}`);
  cache.set(text, modules);
  return modules;
}

/** Printed width including the quiet zone on each side. */
export function code128WidthMm(text: string): number {
  return (code128Modules(text).length + 2 * QUIET_MODULES) * MODULE_MM;
}

/** Whether the barcode fits the paper from its left edge. */
export function fitsReceipt(text: string): boolean {
  return code128WidthMm(text) <= RECEIPT_WIDTH_MM - BAR_LEFT_DOTS * DOT_MM;
}

/** The barcode at exactly MODULE_MM per module, quiet zones included, `heightMm` tall. */
export function code128Svg(text: string, heightMm: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, text, {
    format: "CODE128",
    width: 1,
    height: BAR_UNITS,
    margin: QUIET_MODULES,
    marginTop: 0,
    marginBottom: 0,
    displayValue: false,
  });
  const units = code128Modules(text).length + 2 * QUIET_MODULES;
  svg.setAttribute("viewBox", `0 0 ${units} ${BAR_UNITS}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("width", `${units * MODULE_MM}mm`);
  svg.setAttribute("height", `${heightMm}mm`);
  Object.assign(svg.style, {
    display: "block",
    width: `${units * MODULE_MM}mm`,
    height: `${heightMm}mm`,
  });
  return svg;
}
