import type { ExportKind, ExportState, SessionState } from "../log/types";

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

/** There is an Evergreen download, and an import came after the latest one. */
export function evergreenStale(s: Pick<SessionState, "exports" | "imports">): boolean {
  const last = s.exports.filter((e) => e.kind === "xacts").reduce((m, e) => Math.max(m, e.at), -1);
  return last >= 0 && s.imports.some((i) => i.at > last);
}
