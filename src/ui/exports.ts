import type { ExportKind, ExportState } from "../log/types";

export const EXPORT_NOUNS: Record<ExportKind, string> = {
  pdf: "PDF",
  csv: "CSV file",
  xlsx: "Excel file",
  xacts: "Evergreen file",
};

const ORDER: ExportKind[] = ["pdf", "csv", "xlsx", "xacts"];

/** One line per export kind, from its latest recorded download. */
export function exportLines(
  exports: ExportState[],
  time: (at: number) => string,
): { kind: ExportKind; text: string }[] {
  return ORDER.map((kind) => {
    const noun = EXPORT_NOUNS[kind];
    const latest = exports
      .filter((e) => e.kind === kind)
      .reduce<ExportState | null>((a, e) => (!a || e.at >= a.at ? e : a), null);
    if (!latest) return { kind, text: `No ${noun} download recorded` };
    const where = latest.workstation ? ` (${latest.workstation})` : "";
    return {
      kind,
      text: `${noun}: downloaded ${time(latest.at)} by ${latest.employee}${where}`,
    };
  });
}
