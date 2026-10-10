import { test, expect, describe } from "vite-plus/test";
import { reduce } from "./reduce";
import type { LogRecord, SessionState } from "./types";
import { mk } from "./helpers.test-util";

const plain = (s: SessionState) => JSON.stringify({ ...s, patronIndex: [...s.patronIndex] });

describe("reduce", () => {
  test("visit with two items", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:1", item: "I2" }),
    ]);
    expect(s.totals).toEqual({ patrons: 1, items: 2 });
    expect(s.visits[0].items).toHaveLength(2);
  });
  test("voiding an item keeps it but uncounts it", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:1", item: "I2" }),
      mk("a", 4, { type: "voided", target: "a:2" }),
    ]);
    expect(s.visits[0].items).toHaveLength(2);
    expect(s.visits[0].items[0].voided).toBe(true);
    expect(s.visits[0].voided).toBe(false);
    expect(s.totals).toEqual({ patrons: 1, items: 1 });
  });
  test("voiding a visit voids its items", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("a", 3, { type: "voided", target: "a:1" }),
    ]);
    expect(s.visits[0].voided).toBe(true);
    expect(s.visits[0].items.every((i) => i.voided)).toBe(true);
    expect(s.totals).toEqual({ patrons: 0, items: 0 });
  });
  test("same patron twice", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "patron-ended", visitId: "a:1" }),
      mk("a", 3, { type: "patron-started", patron: "P1" }),
    ]);
    expect(s.patronIndex.get("P1")).toHaveLength(2);
    expect(s.totals.patrons).toBe(1);
    expect(s.visits[0].ended).toBe(true);
    expect(s.visits[1].ended).toBe(false);
  });
  test("created and closed", () => {
    const s = reduce([
      mk("a", 1, { type: "session-created", name: "Book Fair" }),
      mk("a", 2, { type: "session-closed" }),
    ]);
    expect(s.name).toBe("Book Fair");
    expect(s.sessionId).toBe("S");
    expect(s.closed).toBe(true);
    expect(reduce([]).closed).toBe(false);
    expect(reduce([]).sessionId).toBeNull();
  });
  test("perClerk counts non-voided by employee", () => {
    const s = reduce([
      mk("a", 1, { type: "patron-started", patron: "P1" }),
      mk("a", 2, { type: "item-scanned", visitId: "a:1", item: "I1" }),
      mk("b", 1, { type: "item-scanned", visitId: "a:1", item: "I2" }),
      mk("b", 2, { type: "patron-started", patron: "P2" }),
      mk("b", 3, { type: "voided", target: "b:2" }),
    ]);
    expect(s.perClerk).toEqual({ A: { patrons: 1, items: 1 }, B: { patrons: 0, items: 1 } });
  });
  test("orphan items attach when the visit arrives", () => {
    const item = mk("b", 1, { type: "item-scanned", visitId: "a:1", item: "I1" });
    const visit = mk("a", 1, { type: "patron-started", patron: "P1" });
    expect(reduce([item]).visits).toHaveLength(0);
    expect(reduce([item, visit]).visits[0].items).toHaveLength(1);
  });
  test("arrival-order independence", () => {
    const log: LogRecord[] = [
      mk("a", 1, { type: "session-created", name: "N" }),
      mk("a", 2, { type: "patron-started", patron: "P1" }),
      mk("a", 3, { type: "item-scanned", visitId: "a:2", item: "I1" }),
      mk("a", 4, { type: "item-scanned", visitId: "a:2", item: "I2" }),
      mk("b", 1, { type: "patron-started", patron: "P2" }),
      mk("b", 2, { type: "item-scanned", visitId: "b:1", item: "I3" }),
      mk("a", 5, { type: "voided", target: "a:4" }),
      mk("b", 3, { type: "patron-ended", visitId: "b:1" }),
      mk("a", 6, { type: "patron-started", patron: "P1" }),
      mk("b", 4, { type: "item-scanned", visitId: "a:6", item: "I4" }),
      mk("b", 5, { type: "voided", target: "b:1" }),
      mk("a", 7, { type: "session-closed" }),
    ];
    const expected = plain(reduce(log));
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 20; n++) {
      const shuffled = [...log];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(plain(reduce(shuffled))).toBe(expected);
    }
  });
  test("duplicate delivery of a record is ignored", () => {
    const r = mk("a", 1, { type: "patron-started", patron: "P1" });
    expect(reduce([r, r]).visits).toHaveLength(1);
  });
});
