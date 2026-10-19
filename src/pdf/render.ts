import { jsPDF } from "jspdf";
import type { SessionState } from "../log/types";
import { blocksFromState } from "./blocks";
import { CONTROL } from "../log/barcode";
import { code128Modules, QUIET_MODULES } from "../print/code128";
import { GEOMETRY, layout, MODULE_IN, SUMMARY_LINE_H } from "./layout";

const BAR_FONT_PT = 8;
const CARD_MODULE_IN = 0.015;
const CARD_BAR_H = 0.7;

function newDoc(compress: boolean): jsPDF {
  return new jsPDF({ unit: "in", format: "letter", orientation: "portrait", compress });
}

/** Filled black vector rects, one per run of bars. Returns the x of the bar area's left edge. */
function drawBars(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  module: number,
  barH: number,
): { left: number; width: number } {
  const modules = code128Modules(text);
  const left = x + QUIET_MODULES * module;
  doc.setFillColor(0, 0, 0);
  for (const m of modules.matchAll(/1+/g)) {
    doc.rect(left + m.index * module, y, m[0].length * module, barH, "F");
  }
  return { left, width: modules.length * module };
}

function drawText(doc: jsPDF, text: string, x: number, y: number, opts?: { align?: "center" }) {
  doc.text(text, x, y, { baseline: "top", ...opts });
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// jsPDF's standard fonts are WinAnsi; "—" and "·" are replaced with ASCII to stay reliably extractable.
export function buildSessionPdf(state: SessionState, opts: { date: Date }, compress = true): jsPDF {
  const g = GEOMETRY;
  const summary = [
    `Patrons: ${state.totals.patrons}`,
    `Items: ${state.totals.items}`,
    ...Object.keys(state.perClerk)
      .sort()
      .map((c) => {
        const { patrons, items } = state.perClerk[c];
        return `${c}: ${patrons} patron${patrons === 1 ? "" : "s"}, ${items} item${items === 1 ? "" : "s"}`;
      }),
  ];
  const { pages, elements } = layout(blocksFromState(state), summary);
  const doc = newDoc(compress);
  for (let p = 2; p <= pages; p++) doc.addPage();
  const title = `${state.name ?? "Session"} - ${ymd(opts.date)}`;

  for (const el of elements) {
    doc.setPage(el.page);
    doc.setTextColor(0, 0, 0);
    switch (el.kind) {
      case "page-header":
        doc.setFont("helvetica", "normal").setFontSize(10);
        drawText(doc, `${title} - Page ${el.page} of ${pages}`, g.margin, g.margin);
        break;
      case "barcode": {
        const bars = drawBars(doc, el.text, el.x, el.y, MODULE_IN, g.barH);
        const cx = bars.left + bars.width / 2;
        const ty = el.y + g.barH + (g.textH - BAR_FONT_PT / 72) / 2;
        doc.setFont("courier", el.role === "patron" ? "bold" : "normal").setFontSize(BAR_FONT_PT);
        drawText(doc, el.text, cx, ty, { align: "center" });
        if (el.continued) {
          const w = doc.getTextWidth(el.text);
          doc.setFont("helvetica", "italic");
          drawText(doc, "(continued)", cx + w / 2 + 0.08, ty);
        }
        break;
      }
      case "box":
        doc.setDrawColor(0, 0, 0).setLineWidth(0.01);
        doc.rect(el.x, el.y, el.w, el.h, "S");
        break;
      case "caption":
        doc.setFont("helvetica", "normal").setFontSize(8);
        drawText(doc, el.text.replace("·", "|"), el.x, el.y + 0.04);
        break;
      case "summary":
        doc.setFont("helvetica", "normal").setFontSize(10);
        el.lines.forEach((l, i) => drawText(doc, l, el.x, el.y + i * SUMMARY_LINE_H));
        break;
    }
  }
  return doc;
}

export function renderSessionPdf(state: SessionState, opts: { date: Date }): Blob {
  return buildSessionPdf(state, opts).output("blob");
}

export function buildScannerCard(compress = true): jsPDF {
  const doc = newDoc(compress);
  const g = GEOMETRY;
  doc.setTextColor(0, 0, 0).setFont("helvetica", "bold").setFontSize(18);
  drawText(doc, "Offline Checkout - Scanner card", g.margin, g.margin);
  const cards = [
    { code: CONTROL.END, label: "End patron" },
    { code: CONTROL.VOIDLAST, label: "Void last item" },
  ];
  let y = g.margin + 0.9;
  for (const c of cards) {
    doc.setFont("helvetica", "bold").setFontSize(14);
    drawText(doc, c.label, g.margin, y);
    const bars = drawBars(doc, c.code, g.margin, y + 0.4, CARD_MODULE_IN, CARD_BAR_H);
    doc.setFont("courier", "normal").setFontSize(12);
    drawText(doc, c.code, bars.left + bars.width / 2, y + 0.4 + CARD_BAR_H + 0.08, {
      align: "center",
    });
    y += 2.4;
  }
  return doc;
}

export function renderScannerCard(): Blob {
  return buildScannerCard().output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
