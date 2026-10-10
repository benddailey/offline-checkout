import { CODE39_TEXT, CONTROL } from "./barcode";
import { MAX_BARCODE, MAX_NAME } from "./limits";
import type { LogRecord } from "./types";

/** Device and session ids: randomId(10). */
const ID = /^[0-9a-z]{10}$/;
/** RecordId: `${deviceId}:${seq}`. */
const RECORD_ID = /^[0-9a-z]{10}:[1-9][0-9]*$/;

const isStr = (v: unknown): v is string => typeof v === "string";
const isName = (v: unknown): v is string => isStr(v) && v.length <= MAX_NAME;
const isRecordId = (v: unknown): v is string => isStr(v) && RECORD_ID.test(v);
/** A barcode the PDF can print: Code 39 text, not a control code, not absurdly long. */
const isBarcode = (v: unknown): v is string =>
  isStr(v) &&
  v.length <= MAX_BARCODE &&
  CODE39_TEXT.test(v) &&
  v !== CONTROL.END &&
  v !== CONTROL.VOIDLAST;

/** A well-formed record whose contents are safe to store, reduce and print (peer input). */
export function isLogRecord(x: unknown): x is LogRecord {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  if (
    !isStr(r.sessionId) ||
    !ID.test(r.sessionId) ||
    !isStr(r.deviceId) ||
    !ID.test(r.deviceId) ||
    !isName(r.employee) ||
    typeof r.seq !== "number" ||
    !Number.isInteger(r.seq) ||
    r.seq <= 0 ||
    typeof r.at !== "number" ||
    !Number.isFinite(r.at)
  ) {
    return false;
  }
  switch (r.type) {
    case "session-created":
      return isName(r.name);
    case "patron-started":
      return isBarcode(r.patron);
    case "item-scanned":
      return isRecordId(r.visitId) && isBarcode(r.item);
    case "patron-ended":
      return isRecordId(r.visitId);
    case "voided":
      return isRecordId(r.target);
    case "session-closed":
      return true;
    default:
      return false;
  }
}
