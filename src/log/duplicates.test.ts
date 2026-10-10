import { test, expect, describe } from "vite-plus/test";
import { reduce } from "./reduce";
import { checkItem } from "./duplicates";
import { mk } from "./helpers.test-util";

describe("checkItem", () => {
  test("item on current visit", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
    ]);
    expect(checkItem(s, "a:1", "I1")).toEqual({ kind: "dup-this-patron" });
    expect(checkItem(s, "a:1", "I9")).toEqual({ kind: "ok" });
  });
  test("item on earlier visit of same patron", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "patron-ended", visitId: "a:1" }),
      mk("a", 4, { type: "patron-started", patron: "P1" }),
    ]);
    expect(checkItem(s, "a:4", "I1")).toEqual({ kind: "dup-this-patron" });
  });
  test("item on another patron", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P2" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "patron-started", patron: "P1" }),
    ]);
    expect(checkItem(s, "a:3", "I1")).toEqual({ kind: "dup-other-patron", patrons: ["P2"] });
  });
  test("other patrons are distinct and sorted", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P3" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "patron-started", patron: "P2" }),
      mk("a", 4, { type: "item-scanned", visitId: "a:3", item: "I1" }),
      mk("a", 5, { type: "patron-started", patron: "P3" }),
      mk("a", 6, { type: "item-scanned", visitId: "a:5", item: "I1" }),
      mk("a", 7, { type: "patron-started", patron: "P1" }),
    ]);
    expect(checkItem(s, "a:7", "I1")).toEqual({ kind: "dup-other-patron", patrons: ["P2", "P3"] });
  });
  test("voided item or visit is ok", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P2" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "voided", target: "a:2" }),
      mk("a", 4, { type: "patron-started", patron: "P3" }),
      mk("a", 5, { type: "item-scanned", visitId: "a:4", item: "I2" }),
      mk("a", 6, { type: "voided", target: "a:4" }),
      mk("a", 7, { type: "patron-started", patron: "P1" }),
    ]);
    expect(checkItem(s, "a:7", "I1")).toEqual({ kind: "ok" });
    expect(checkItem(s, "a:7", "I2")).toEqual({ kind: "ok" });
  });
  test("unknown visit is ok", () => {
    expect(checkItem(reduce([]), "x:1", "I1")).toEqual({ kind: "ok" });
  });
});
