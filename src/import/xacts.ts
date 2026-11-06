import { RejectFile, type NumberedRow } from "./rows";

const KEYS = ["barcode", "checkout_time", "delta", "patron_barcode", "timestamp", "type"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Only the six keys buildXacts writes: a line with a due_date is someone else's, not silently trimmed. */
export function parseXacts(text: string): NumberedRow[] {
  const out: NumberedRow[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line === "") continue;
    const rowNumber = i + 1;
    const notOurs = new RejectFile(`Line ${rowNumber}: this is not a checkout the app wrote.`);
    let x: unknown;
    try {
      x = JSON.parse(line);
    } catch {
      throw notOurs;
    }
    if (typeof x !== "object" || x === null || Array.isArray(x)) throw notOurs;
    const o = x as Record<string, unknown>;
    if (Object.keys(o).sort().join() !== KEYS.join()) throw notOurs;
    if (
      o.type !== "checkout" ||
      o.delta !== 0 ||
      typeof o.timestamp !== "number" ||
      !Number.isInteger(o.timestamp) ||
      typeof o.patron_barcode !== "string" ||
      typeof o.barcode !== "string" ||
      typeof o.checkout_time !== "string" ||
      !ISO.test(o.checkout_time)
    ) {
      throw notOurs;
    }
    const at = Date.parse(o.checkout_time);
    if (Number.isNaN(at)) throw notOurs;
    if (Math.abs(at - o.timestamp * 1000) > 1000) {
      throw new RejectFile(`Line ${rowNumber}: timestamp and checkout_time differ.`);
    }
    out.push({
      rowNumber,
      patron: o.patron_barcode,
      item: o.barcode,
      scannedAt: at,
      clerk: "",
      workstation: "",
    });
  }
  return out;
}
