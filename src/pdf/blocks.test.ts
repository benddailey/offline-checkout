import { test, expect, describe } from "vite-plus/test";
import { reduce } from "../log/reduce";
import { mk } from "../log/helpers.test-util";
import { blocksFromState } from "./blocks";

describe("blocksFromState", () => {
  test("merges visits per patron and dedupes items", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:1", item: "I2" }),
      mk("b", 4, { type: "patron-started", patron: "P1" }),
      mk("b", 5, { type: "item-scanned", visitId: "b:4", item: "I2" }),
      mk("b", 6, { type: "item-scanned", visitId: "b:4", item: "I3" }),
    ]);
    expect(blocksFromState(s)).toEqual([
      { patron: "P1", items: ["I1", "I2", "I3"], clerks: ["A", "B"], firstAt: 1000 },
    ]);
  });
  test("drops voided items and fully voided patrons; sorts by firstAt", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "voided", target: "a:1" }),
      mk("a", 4, { type: "patron-started", patron: "P3" }),
      mk("a", 5, { type: "item-scanned", visitId: "a:4", item: "I5" }),
      mk("a", 6, { type: "item-scanned", visitId: "a:4", item: "I6" }),
      mk("a", 7, { type: "voided", target: "a:5" }),
      mk("a", 8, { type: "patron-started", patron: "P2" }),
    ]);
    expect(blocksFromState(s).map((b) => [b.patron, b.items])).toEqual([
      ["P3", ["I6"]],
      ["P2", []],
    ]);
  });
  test("tie on firstAt sorts by patron", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "PB" }, 5),
      mk("b", 1, { type: "patron-started", patron: "PA" }, 5),
    ]);
    expect(blocksFromState(s).map((b) => b.patron)).toEqual(["PA", "PB"]);
  });
});
