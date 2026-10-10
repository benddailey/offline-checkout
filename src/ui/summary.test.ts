import { describe, expect, test } from "vite-plus/test";
import { mk } from "../log/helpers.test-util";
import { reduce } from "../log/reduce";
import { summaryPatrons } from "./summary";

describe("summaryPatrons", () => {
  test("a voided visit and a live visit for the same patron make one live entry", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "voided", target: "a:1" }),
      mk("b", 4, { type: "patron-started", patron: "P2" }),
      mk("a", 5, { type: "patron-started", patron: "P1" }),
      mk("a", 6, { type: "item-scanned", visitId: "a:5", item: "I2" }),
    ]);
    // P1 is ordered by its first live visit (at 5000), as on the PDF.
    expect(summaryPatrons(s)).toEqual([
      { patron: "P2", voided: false, rows: [], items: 0, clerks: ["B"], at: 4000 },
      {
        patron: "P1",
        voided: false,
        rows: [
          { id: "a:2", barcode: "I1", voided: true },
          { id: "a:6", barcode: "I2", voided: false },
        ],
        items: 1,
        clerks: ["A"],
        at: 5000,
      },
    ]);
  });

  test("an item scanned again on a second visit is listed once, like the PDF", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "patron-ended", visitId: "a:1" }),
      mk("b", 4, { type: "patron-started", patron: "P1" }),
      mk("b", 5, { type: "item-scanned", visitId: "b:4", item: "I1" }),
      mk("b", 6, { type: "item-scanned", visitId: "b:4", item: "I3" }),
    ]);
    const [p1] = summaryPatrons(s);
    expect(p1!.rows.map((r) => r.barcode)).toEqual(["I1", "I3"]);
    expect(p1!.items).toBe(2);
    expect(p1!.clerks).toEqual(["A", "B"]);
  });

  test("a fully voided patron is listed, marked voided, with its items voided", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("b", 3, { type: "patron-started", patron: "P3" }),
      mk("b", 4, { type: "item-scanned", visitId: "b:3", item: "I4" }),
      mk("b", 5, { type: "voided", target: "b:3" }),
    ]);
    expect(summaryPatrons(s)).toEqual([
      {
        patron: "P1",
        voided: false,
        rows: [{ id: "a:2", barcode: "I1", voided: false }],
        items: 1,
        clerks: ["A"],
        at: 1000,
      },
      {
        patron: "P3",
        voided: true,
        rows: [{ id: "b:4", barcode: "I4", voided: true }],
        items: 0,
        clerks: ["B"],
        at: 3000,
      },
    ]);
  });
});
