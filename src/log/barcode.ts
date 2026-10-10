export const CONTROL = { END: "OC-END", VOIDLAST: "OC-VOIDLAST" } as const;

export function normalizeScan(raw: string): string {
  return raw.trim().toUpperCase();
}

export type BarcodeCheck = { ok: true } | { ok: false; reason: string };

/** A non-empty string made only of Code 39 characters. */
export const CODE39_TEXT = /^[0-9A-Z\-. $/+%]+$/;

const BAD_CHARS = /[^0-9A-Z\-. $/+%]/g;

export function validateBarcode(code: string): BarcodeCheck {
  if (code === "") return { ok: false, reason: "The barcode is empty" };
  if (code === CONTROL.END || code === CONTROL.VOIDLAST) {
    return { ok: false, reason: `"${code}" is a reserved control code` };
  }
  const bad = [...new Set(code.match(BAD_CHARS) ?? [])];
  if (bad.length > 0) {
    const list = bad.map((c) => `"${c}"`).join(", ");
    return { ok: false, reason: `Contains characters a Code 39 barcode can't hold: ${list}` };
  }
  return { ok: true };
}
