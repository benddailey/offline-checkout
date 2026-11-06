import { validateBarcode } from "../log/barcode";
import { isCsvHeader, parseCsv } from "./csv";
import {
  RejectFile,
  type FileFormat,
  type FileRejection,
  type FileSource,
  type NumberedRow,
} from "./rows";
import { parseXacts } from "./xacts";
import { parseXlsx } from "./xlsx";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const DAY = 24 * 60 * 60 * 1000;
const EXCEL_NUMBER = /^\d+(\.\d+)?E\+\d+$/;

const reject = (name: string, reason: string): FileRejection => ({ name, reason });

function checkBarcode(value: string, rowNumber: number, label: string): void {
  if (EXCEL_NUMBER.test(value)) {
    throw new RejectFile(`${label} ${rowNumber}: "${value}" looks like a number Excel changed.`);
  }
  const check = validateBarcode(value);
  if (!check.ok) throw new RejectFile(`${label} ${rowNumber}: ${check.reason}`);
}

export function checkRows(rows: NumberedRow[], format: FileFormat, now: number): void {
  const label = format === "xacts" ? "Line" : "Row";
  for (const r of rows) {
    checkBarcode(r.patron, r.rowNumber, label);
    if (r.item !== "") checkBarcode(r.item, r.rowNumber, label);
    if (r.item !== "" && r.scannedAt === null) {
      throw new RejectFile(`${label} ${r.rowNumber}: the item has no time.`);
    }
    if (r.scannedAt !== null && !Number.isFinite(r.scannedAt)) {
      throw new RejectFile(`${label} ${r.rowNumber}: Scanned at is not a date.`);
    }
    if (r.scannedAt !== null && r.scannedAt > now + DAY) {
      throw new RejectFile(`${label} ${r.rowNumber}: the time is more than a day in the future.`);
    }
  }
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

export function readImportFile(
  name: string,
  bytes: Uint8Array,
  now: number,
): FileSource | FileRejection {
  const unknown = reject(name, "This isn't a file exported by Offline Checkout.");
  if (bytes.length > MAX_FILE_BYTES) return reject(name, "This file is over 50 MB.");
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return reject(
      name,
      "A PDF can't be added because it has no scan times. Use the Excel or Evergreen file.",
    );
  }
  try {
    const zip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    const text = zip ? "" : new TextDecoder().decode(bytes);
    let format: FileFormat;
    let rows: NumberedRow[];
    if (zip) {
      format = "xlsx";
      rows = parseXlsx(bytes);
    } else if (text.startsWith("{")) {
      format = "xacts";
      rows = parseXacts(text);
    } else if (isCsvHeader(text)) {
      format = "csv";
      rows = parseCsv(text);
    } else {
      return unknown;
    }
    checkRows(rows, format, now);
    return {
      kind: "file",
      name,
      format,
      rows: rows.map(({ patron, item, scannedAt, clerk, workstation }) => ({
        patron,
        item,
        scannedAt,
        clerk,
        workstation,
      })),
    };
  } catch (e) {
    if (e instanceof RejectFile) return reject(name, e.message);
    return reject(name, "This file could not be read.");
  }
}

export async function readImportFiles(
  files: File[],
  now: number,
): Promise<(FileSource | FileRejection)[]> {
  return Promise.all(
    files.map(async (f) => {
      if (f.size > MAX_FILE_BYTES) return reject(f.name, "This file is over 50 MB.");
      try {
        return readImportFile(f.name, new Uint8Array(await f.arrayBuffer()), now);
      } catch {
        return reject(f.name, "This file could not be read.");
      }
    }),
  );
}
