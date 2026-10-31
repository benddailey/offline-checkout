import { strToU8, zipSync } from "fflate";
import type { SessionState } from "../log/types";
import { COLUMNS, type ExportRow } from "./rows";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Style ids in styles.xml's cellXfs. */
const S = { bold: 1, date: 2, text: 3 } as const;

type Cell = string | number | { date: number } | null;
interface Row {
  cells: Cell[];
  style?: number;
  /** Bold the first cell only. */
  label?: boolean;
}

// Characters XML 1.0 forbids would make Excel refuse the file; names are free text.
// oxlint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function esc(v: string): string {
  return v
    .replace(NOT_XML, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Excel serial date for the local wall-clock time of `ms`. */
export function excelDate(ms: number): number {
  const d = new Date(ms);
  const wall = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return wall / 86_400_000 + 25_569;
}

function cellXml(ref: string, v: Cell, style?: number): string {
  if (v === null || v === "") return "";
  if (typeof v === "number") return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
  if (typeof v === "object") return `<c r="${ref}" s="${S.date}"><v>${excelDate(v.date)}</v></c>`;
  const s = style ?? S.text;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

const col = (i: number) => String.fromCharCode(65 + i);

function sheetXml(rows: Row[], opts: { widths: number[]; freeze: boolean; selected: boolean }) {
  const pane = opts.freeze
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>'
    : "";
  const cols = opts.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const data = rows
    .map((r, ri) => {
      const cells = r.cells
        .map((v, ci) => cellXml(`${col(ci)}${ri + 1}`, v, ci === 0 && r.label ? S.bold : r.style))
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const ignore = `<ignoredErrors><ignoredError sqref="A1:${col(opts.widths.length - 1)}${Math.max(rows.length, 1)}" numberStoredAsText="1"/></ignoredErrors>`;
  return (
    `${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
    `<sheetViews><sheetView workbookViewId="0"${opts.selected ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${data}</sheetData>${ignore}</worksheet>`
  );
}

function widths(rows: Row[], count: number, min: number[]): number[] {
  return Array.from({ length: count }, (_, i) => {
    const longest = Math.max(
      ...rows.map((r) => {
        const v = r.cells[i];
        return typeof v === "string" ? v.length : typeof v === "number" ? String(v).length : 0;
      }),
    );
    return Math.min(60, Math.max(min[i] ?? 10, longest + 2));
  });
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** An Items sheet with the export rows and a Summary sheet with the PDF's totals. */
export function buildXlsx(
  state: SessionState,
  rows: ExportRow[],
  now: Date,
): Uint8Array<ArrayBuffer> {
  const items: Row[] = [
    { cells: [...COLUMNS], style: S.bold },
    ...rows.map((r) => ({
      cells: [
        r.patron,
        r.item,
        r.scannedAt === null ? null : { date: r.scannedAt },
        r.clerk,
        r.session,
      ],
    })),
  ];
  const clerks = Object.keys(state.perClerk).sort();
  const summary: Row[] = [
    { cells: ["Session", state.name ?? ""], label: true },
    { cells: ["Exported", { date: now.getTime() }], label: true },
    { cells: ["Patrons", state.totals.patrons], label: true },
    { cells: ["Items", state.totals.items], label: true },
    { cells: [] },
    { cells: ["Clerk", "Patrons", "Items"], style: S.bold },
    ...clerks.map((c) => ({
      cells: [c, state.perClerk[c]!.patrons, state.perClerk[c]!.items],
    })),
  ];

  const files: Record<string, string> = {
    "[Content_Types].xml":
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>",
    "_rels/.rels":
      `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
      "</Relationships>",
    "xl/workbook.xml":
      `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>` +
      '<sheet name="Items" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/>' +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/>` +
      "</Relationships>",
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheetXml(items, {
      widths: widths(items, 5, [16, 16, 20, 12, 16]),
      freeze: true,
      selected: true,
    }),
    "xl/worksheets/sheet2.xml": sheetXml(summary, {
      widths: widths(summary, 3, [12, 20, 10]),
      freeze: false,
      selected: false,
    }),
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  ) as Uint8Array<ArrayBuffer>;
}
