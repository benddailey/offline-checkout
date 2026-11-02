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
      { patron: "P1", item: "I1", scannedAt: 3000, clerk: "A", workstation: "", session: "Outage" },
      { patron: "P1", item: "I2", scannedAt: 5000, clerk: "B", workstation: "", session: "Outage" },
      { patron: "P2", item: "I3", scannedAt: 8000, clerk: "A", workstation: "", session: "Outage" },
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
      { patron: "P1", item: "", scannedAt: null, clerk: "A", workstation: "", session: "" },
    ]);
  });
});

test("rows carry the workstation that scanned the item, or started an empty patron", () => {
  const at = <T extends object>(r: T, workstation: string) => ({ ...r, workstation });
  const s = reduce([
    at(mk("a", 1, { type: "patron-started", patron: "P1" }), "Desk 1"),
    at(mk("b", 1, { type: "item-scanned", visitId: "a:1", item: "I1" }), "Desk 2"),
    at(mk("a", 2, { type: "patron-started", patron: "P2" }), "Desk 1"),
  ]);
  expect(exportRows(s).map((r) => r.workstation)).toEqual(["Desk 2", "Desk 1"]);
});

test("an earlier scan in a later visit wins, at the barcode's first position", () => {
  const at = <T extends object>(r: T, workstation: string) => ({ ...r, workstation });
  // Visit a:1 opens first, but visit b:1 on another workstation scans X before a:1 does.
  const s = reduce([
    at(mk("a", 1, { type: "patron-started", patron: "P1" }, 1000), "Desk 1"),
    at(mk("b", 1, { type: "patron-started", patron: "P1" }, 2000), "Desk 2"),
    at(mk("b", 2, { type: "item-scanned", visitId: "b:1", item: "Z" }, 2500), "Desk 2"),
    at(mk("b", 3, { type: "item-scanned", visitId: "b:1", item: "X" }, 3000), "Desk 2"),
    at(mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "W" }, 4000), "Desk 1"),
    at(mk("a", 3, { type: "item-scanned", visitId: "a:1", item: "X" }, 5000), "Desk 1"),
  ]);
  expect(exportRows(s).map((r) => [r.item, r.scannedAt, r.clerk, r.workstation])).toEqual([
    ["W", 4000, "A", "Desk 1"],
    ["X", 3000, "B", "Desk 2"],
    ["Z", 2500, "B", "Desk 2"],
  ]);
});

test("a patron whose items were all voided gets the first visit's clerk and workstation", () => {
  const at = <T extends object>(r: T, workstation: string) => ({ ...r, workstation });
  const s = reduce([
    at(mk("a", 1, { type: "patron-started", patron: "P1" }), "Desk 1"),
    at(mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }), "Desk 1"),
    at(mk("b", 3, { type: "patron-started", patron: "P1" }), "Desk 2"),
    at(mk("b", 4, { type: "item-scanned", visitId: "b:3", item: "I2" }), "Desk 2"),
    mk("b", 5, { type: "voided", target: "a:2" }),
    mk("b", 6, { type: "voided", target: "b:4" }),
  ]);
  expect(exportRows(s)).toEqual([
    { patron: "P1", item: "", scannedAt: null, clerk: "A", workstation: "Desk 1", session: "" },
  ]);
});

test("a barcode scanned twice in one visit gives one row with the first scan", () => {
  const s = reduce([
    mk("a", 1, { type: "patron-started", patron: "P1" }),
    mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
    mk("a", 3, { type: "item-scanned", visitId: "a:1", item: "I1" }),
  ]);
  expect(exportRows(s)).toEqual([
    { patron: "P1", item: "I1", scannedAt: 2000, clerk: "A", workstation: "", session: "" },
  ]);
});

test("localDateTime is local wall-clock time", () => {
  expect(localDateTime(new Date(2026, 9, 31, 9, 5, 7).getTime())).toBe("2026-10-31 09:05:07");
});
