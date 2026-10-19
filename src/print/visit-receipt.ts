import { BAR_LEFT_DOTS, code128Svg, DOT_MM, fitsReceipt } from "./code128";
import { printElement, RECEIPT_WIDTH_MM } from "./print";
import type { VisitReceipt } from "./receipt";

const BAR_HEIGHT_MM = 10;

/** Rows start at the paper's left edge (the root's 3 mm padding undone); barcodes are wider than the padded body. */
const CSS = `
#oc-print-root .oc-visit-row {
  margin: 3mm -3mm 0; width: ${RECEIPT_WIDTH_MM}mm; padding-left: ${BAR_LEFT_DOTS * DOT_MM}mm;
  box-sizing: border-box; break-inside: avoid;
}
#oc-print-root .oc-visit-bar { display: inline-block; font-size: 10pt; }
#oc-print-root .oc-visit-rule { border-top: 1px solid #000; margin-top: 3mm; padding-top: 1mm; }
`;

function line(text: string, className = "", bold = false): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = text;
  if (className) div.className = className;
  if (bold) div.style.fontWeight = "bold";
  return div;
}

/** A label, the barcode and its text; text alone with a note when the barcode would not fit. All text via textContent: it comes from peers. */
function barcodeRow(label: string, text: string): HTMLElement {
  const row = line("", "oc-visit-row");
  const bar = line("", "oc-visit-bar");
  bar.append(line(label));
  if (fitsReceipt(text)) {
    row.dataset.barcode = text;
    bar.append(code128Svg(text, BAR_HEIGHT_MM), line(text));
  } else {
    bar.append(line(text, "", true), line("Too long for a barcode — type it in"));
  }
  row.append(bar);
  return row;
}

export function renderVisitReceipt(r: VisitReceipt): HTMLElement {
  const box = document.createElement("div");
  const title = line("Offline Checkout", "", true);
  title.style.fontSize = "14pt";
  box.append(title, line(r.session), line(r.when), line(`Clerk: ${r.clerk}`));
  box.append(barcodeRow("Patron", r.patron), line("", "oc-visit-rule"));
  r.items.forEach((item, i) => {
    box.append(barcodeRow(`Item ${i + 1} of ${r.items.length}`, item));
  });
  box.append(line(`Items: ${r.items.length}`, "oc-visit-rule"));
  return box;
}

export function printVisitReceipt(r: VisitReceipt): void {
  printElement(renderVisitReceipt(r), CSS);
}
