import { CONTROL } from "../log/barcode";
import { BAR_LEFT_DOTS, code128Svg, DOT_MM } from "./code128";
import { printElement, RECEIPT_WIDTH_MM } from "./print";

const BAR_HEIGHT_MM = 15;

/** Rows start at the paper's left edge (the root's 3 mm padding undone), like the other receipts. */
const CSS = `
#oc-print-root .oc-card-row {
  margin: 5mm -3mm 0; width: ${RECEIPT_WIDTH_MM}mm; padding-left: ${BAR_LEFT_DOTS * DOT_MM}mm;
  box-sizing: border-box; break-inside: avoid;
}
#oc-print-root .oc-card-bar { display: inline-block; text-align: center; font-size: 10pt; }
#oc-print-root .oc-card-label { font-size: 14pt; font-weight: bold; text-align: left; }
`;

function line(text: string, className = ""): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = text;
  if (className) div.className = className;
  return div;
}

export function renderScannerCardReceipt(): HTMLElement {
  const box = document.createElement("div");
  const title = line("Offline Checkout — Scanner card");
  title.style.fontSize = "14pt";
  title.style.fontWeight = "bold";
  box.append(title);
  for (const [label, code] of [
    ["End patron", CONTROL.END],
    ["Void last item", CONTROL.VOIDLAST],
  ] as const) {
    const row = line("", "oc-card-row");
    row.dataset.barcode = code;
    const bar = line("", "oc-card-bar");
    bar.append(line(label, "oc-card-label"), code128Svg(code, BAR_HEIGHT_MM), line(code));
    row.append(bar);
    box.append(row);
  }
  return box;
}

export function printScannerCardReceipt(): void {
  printElement(renderScannerCardReceipt(), CSS);
}
