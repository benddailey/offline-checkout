import { test, expect, describe } from "vite-plus/test";
import { vectorOf, missingFor } from "./vector";
import { mk } from "./helpers.test-util";

const sc = { type: "session-closed" } as const;

describe("vectors", () => {
  test("highest contiguous seq", () => {
    const recs = [1, 2, 3, 5].map((n) => ({ deviceId: "a", seq: n }));
    expect(vectorOf(recs)).toEqual({ a: 3 });
  });
  test("device with no seq 1 is absent-ish (0)", () => {
    expect(vectorOf([{ deviceId: "a", seq: 2 }])).toEqual({ a: 0 });
  });
  test("order and duplicates do not matter", () => {
    const recs = [3, 1, 2, 2].map((n) => ({ deviceId: "a", seq: n }));
    expect(vectorOf(recs)).toEqual({ a: 3 });
  });
  test("missingFor", () => {
    const recs = [mk("b", 2, sc), mk("a", 5, sc), mk("a", 1, sc), mk("a", 3, sc), mk("b", 1, sc)];
    const out = missingFor(recs, { a: 2 }).map((r) => `${r.deviceId}:${r.seq}`);
    expect(out).toEqual(["a:3", "a:5", "b:1", "b:2"]);
  });
});
