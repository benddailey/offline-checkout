import type { ExportRow } from "../export/rows";

export type ImportRow = Omit<ExportRow, "session">;

export type FileFormat = "csv" | "xlsx" | "xacts";

export interface FileSource {
  kind: "file";
  name: string;
  format: FileFormat;
  rows: ImportRow[];
}

export interface FileRejection {
  name: string;
  reason: string;
}

/** Thrown by the parsers; the message is the reason shown to staff. */
export class RejectFile extends Error {}

export interface NumberedRow extends ImportRow {
  /** 1-based as staff count them: the CSV header is row 1, an Evergreen file's first line is 1. */
  rowNumber: number;
}
