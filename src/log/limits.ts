/** Longest barcode the app accepts, locally and from peers. */
export const MAX_BARCODE = 64;
/** Longest session name or clerk name, in UTF-16 units (what `String.length` counts). */
export const MAX_NAME = 100;

/** Trim, then cut to MAX_NAME without splitting a surrogate pair. */
export function clampName(raw: string): string {
  let s = raw.trim();
  if (s.length > MAX_NAME) {
    s = s.slice(0, MAX_NAME);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
}
