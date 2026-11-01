import { describe, expect, test } from "vite-plus/test";
import { reduce } from "../log/reduce";
import { mk } from "../log/helpers.test-util";
import { exportRows, localDateTime } from "./rows";

describe("exportRows", () => {
  test("one row per item in PDF order, duplicates keep their first scan", () => {
    const s = reduce([
      mk("a", 1, { type: "session-created", name: "Outage" }),
      mk("a", 2, { type: "patron-started", patron: "P1" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:2", item: "I1" }),
      mk("b", 4, { type: "patron-started", patron: "P1" }),
      mk("b", 5, { type: "item-scanned", visitId: "b:4", item: "I2" }),
      mk("b", 6, { type: "item-scanned", visitId: "b:4", item: "I1" }),
      mk("a", 7, { type: "patron-started", patron: "P2" }),
      mk("a", 8, { type: "item-scanned", visitId: "a:7", item: "I3" }),
    ]);
    expect(exportRows(s)).toEqual([
      { patron: "P1", item: "I1", scannedAt: 3000, clerk: "A", session: "Outage" },
      { patron: "P1", item: "I2", scannedAt: 5000, clerk: "B", session: "Outage" },
      { patron: "P2", item: "I3", scannedAt: 8000, clerk: "A", session: "Outage" },
    ]);
  });

  test("drops voided items and patrons; a patron left with no items gets one blank row", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "voided", target: "a:2" }),
      mk("a", 4, { type: "patron-started", patron: "P2" }),
      mk("a", 5, { type: "item-scanned", visitId: "a:4", item: "I2" }),
      mk("a", 6, { type: "voided", target: "a:4" }),
    ]);
    expect(exportRows(s)).toEqual([
      { patron: "P1", item: "", scannedAt: null, clerk: "A", session: "" },
    ]);
  });
});

test("localDateTime is local wall-clock time", () => {
  expect(localDateTime(new Date(2026, 9, 31, 9, 5, 7).getTime())).toBe("2026-10-31 09:05:07");
});
