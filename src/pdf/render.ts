import { jsPDF } from "jspdf";
import { hasWorkstations, workstationLabel } from "../log/reduce";
import type { SessionState } from "../log/types";
import { blocksFromState } from "./blocks";
import { CONTROL } from "../log/barcode";
import { code128Modules, QUIET_MODULES } from "../print/code128";
import { barcodeWidth, GEOMETRY, layout, MODULE_IN, SUMMARY_LINE_H } from "./layout";
import { AVERY_5371, cardOrigin, STAFF_MODULE_IN, staffValue } from "./staff-cards";

const BAR_FONT_PT = 8;
const CARD_MODULE_IN = 0.015;
const CARD_BAR_H = 0.7;

function newDoc(compress: boolean): jsPDF {
  return new jsPDF({
    unit: "in",
    format: "letter",
    orientation: "portrait",
    compress,
    floatPrecision: 3,
  });
}

/** Points to at most 3 decimals, as jsPDF writes them with floatPrecision 3. */
const pt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * One filled path of vector rects, one per run of bars. Returns the x of the bar area's left edge.
 * Written straight into the page stream in module units (scaled by `cm`), so each bar is a few
 * small integers: a jsPDF rect() per bar was most of a big session's PDF time and size.
 */
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
  const k = doc.internal.scaleFactor;
  const top = doc.internal.pageSize.getHeight() - y;
  const h = pt(-barH / module);
  const path = [`q ${pt(module * k)} 0 0 ${pt(module * k)} ${pt(left * k)} ${pt(top * k)} cm`];
  for (const m of modules.matchAll(/1+/g)) path.push(`${m.index} 0 ${m[0].length} ${h} re`);
  path.push("f Q");
  doc.setFillColor(0, 0, 0);
  (doc.internal as unknown as { write(s: string): void }).write(path.join("\n"));
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
  const counts = (name: string, { patrons, items }: { patrons: number; items: number }) =>
    `${name}: ${patrons} patron${patrons === 1 ? "" : "s"}, ${items} item${items === 1 ? "" : "s"}`;
  const summary = [
    `Patrons: ${state.totals.patrons}`,
    `Items: ${state.totals.items}`,
    "By clerk:",
    ...Object.keys(state.perClerk)
      .sort()
      .map((c) => counts(c, state.perClerk[c])),
    ...(hasWorkstations(state)
      ? [
          "By workstation:",
          ...Object.entries(state.perWorkstation).map(([w, n]) => counts(workstationLabel(w), n)),
        ]
      : []),
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

const STAFF_BAR_H = 0.6;
const STAFF_FONT_PT = 14;
const STAFF_TEXT_GAP = 0.08;

/** One card per value on an Avery 5371 sheet; empty values leave their card blank. */
export function buildStaffCards(values: readonly string[], compress = true): jsPDF {
  const doc = newDoc(compress);
  const g = AVERY_5371;
  const blockH = STAFF_BAR_H + STAFF_TEXT_GAP + STAFF_FONT_PT / 72;
  doc.setTextColor(0, 0, 0).setFont("courier", "normal").setFontSize(STAFF_FONT_PT);
  values.forEach((raw, i) => {
    const text = staffValue(raw);
    if (text === "") return;
    const { x, y } = cardOrigin(i);
    const barX = x + (g.cardW - barcodeWidth(text, STAFF_MODULE_IN)) / 2;
    const barY = y + (g.cardH - blockH) / 2;
    const bars = drawBars(doc, text, barX, barY, STAFF_MODULE_IN, STAFF_BAR_H);
    drawText(doc, text, bars.left + bars.width / 2, barY + STAFF_BAR_H + STAFF_TEXT_GAP, {
      align: "center",
    });
  });
  return doc;
}

export function renderStaffCards(values: readonly string[]): Blob {
  return buildStaffCards(values).output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
