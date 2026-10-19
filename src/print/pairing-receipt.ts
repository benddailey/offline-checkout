import QRCode from "qrcode";
import { splitCode } from "../pairing/chunks";
import { BAR_LEFT_DOTS, code128Svg, DOT_MM } from "./code128";
import { printElement, RECEIPT_WIDTH_MM } from "./print";

export interface PairingReceipt {
  label: "Join code" | "Reply code";
  code: string;
  sessionName?: string;
  expiresAt?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const QR_MM = 50;
const QR_QUIET = 4;
const BAR_HEIGHT_MM = 10;

/** Rows start at the paper's left edge (the root's 3 mm padding undone); barcodes are wider than the padded body. */
const CSS = `
#oc-print-root .oc-pair-row {
  margin: 3mm -3mm 0; width: ${RECEIPT_WIDTH_MM}mm; padding-left: ${BAR_LEFT_DOTS * DOT_MM}mm;
  box-sizing: border-box; break-inside: avoid;
}
#oc-print-root .oc-pair-bar { display: inline-block; text-align: center; font-size: 10pt; }
`;

function qrSvg(code: string): SVGSVGElement {
  const { modules } = QRCode.create(code, { errorCorrectionLevel: "M" });
  const n = modules.size + 2 * QR_QUIET;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  Object.assign(svg.style, {
    display: "block",
    width: `${QR_MM}mm`,
    height: `${QR_MM}mm`,
    margin: "2mm auto 0",
  });
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(n));
  bg.setAttribute("height", String(n));
  bg.setAttribute("fill", "#fff");
  let path = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) path += `M${x + QR_QUIET} ${y + QR_QUIET}h1v1h-1z`;
    }
  }
  const dark = document.createElementNS(SVG_NS, "path");
  dark.setAttribute("d", path);
  dark.setAttribute("fill", "#000");
  svg.append(bg, dark);
  return svg;
}

function line(text: string, style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = text;
  Object.assign(div.style, style);
  return div;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** QR first, then every chunk as `n of N`. Throws Error("too long") if the code needs too many barcodes. */
export function renderPairingReceipt(r: PairingReceipt): HTMLElement {
  const chunks = splitCode(r.code);
  const box = document.createElement("div");
  box.append(line(`Offline Checkout — ${r.label}`, { fontSize: "14pt", fontWeight: "bold" }));
  if (r.sessionName) box.append(line(r.sessionName));
  if (r.expiresAt !== undefined) box.append(line(`Expires at ${clock(r.expiresAt)}`));
  box.append(line("Scan the QR, or scan every barcode below in any order"), qrSvg(r.code));
  chunks.forEach((chunk, i) => {
    const row = document.createElement("div");
    row.className = "oc-pair-row";
    row.dataset.chunk = chunk;
    const bar = document.createElement("div");
    bar.className = "oc-pair-bar";
    bar.append(code128Svg(chunk, BAR_HEIGHT_MM), line(`${i + 1} of ${chunks.length}`));
    row.append(bar);
    box.append(row);
  });
  return box;
}

/** What QrDisplay shows when Print code fails. */
export function printErrorText(err: unknown): string {
  return err instanceof Error && err.message === "too long"
    ? "This code is too long to print. Use the camera or Copy instead."
    : "Could not print the code. Use the camera or Copy instead.";
}

export function printPairingCode(r: PairingReceipt): void {
  printElement(renderPairingReceipt(r), CSS);
}
