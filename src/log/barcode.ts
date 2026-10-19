import { MAX_BARCODE } from "./limits";

export const CONTROL = { END: "OC-END", VOIDLAST: "OC-VOIDLAST" } as const;

export function normalizeScan(raw: string): string {
  return raw.trim().toUpperCase();
}

export type BarcodeCheck = { ok: true } | { ok: false; reason: string };

/** Characters every scanner types the same and the app has always printed: 0-9 A-Z - . space $ / + %. */
export const BARCODE_TEXT = /^[0-9A-Z\-. $/+%]+$/;

const BAD_CHARS = /[^0-9A-Z\-. $/+%]/g;

export function validateBarcode(code: string): BarcodeCheck {
  if (code === "") return { ok: false, reason: "The barcode is empty" };
  if (code === CONTROL.END || code === CONTROL.VOIDLAST) {
    return { ok: false, reason: `"${code}" is a reserved control code` };
  }
  if (code.length > MAX_BARCODE) {
    return { ok: false, reason: `Barcode is longer than ${MAX_BARCODE} characters` };
  }
  const bad = [...new Set(code.match(BAD_CHARS) ?? [])];
  if (bad.length > 0) {
    const list = bad.map((c) => `"${c}"`).join(", ");
    return { ok: false, reason: `Contains characters the app can't print as a barcode: ${list}` };
  }
  return { ok: true };
}
