import { describe, expect, it } from "vite-plus/test";
import { mk } from "../log/helpers.test-util";
import { reduce } from "../log/reduce";
import type { LogRecord } from "../log/types";
import { visitReceipt } from "./receipt";

const AT = new Date(2026, 9, 18, 9, 5);
const created = mk("a", 1, { type: "session-created", name: "Desk 1" });

function visitWith(...rest: LogRecord[]): LogRecord[] {
  return [
    created,
    mk("a", 2, { type: "patron-started", patron: "P1" }),
    mk("a", 3, { type: "item-scanned", visitId: "a:2", item: "I1" }),
    mk("a", 4, { type: "item-scanned", visitId: "a:2", item: "I2" }),
    mk("a", 5, { type: "item-scanned", visitId: "a:2", item: "I3" }),
    ...rest,
  ];
}

describe("visitReceipt", () => {
  it("lists the visit's non-voided items with session, clerk and local time", () => {
    const state = reduce(visitWith(mk("a", 6, { type: "voided", target: "a:4" })));
    expect(visitReceipt(state, "a:2", AT)).toEqual({
      session: "Desk 1",
      when: "2026-10-18 09:05",
      clerk: "A",
      patron: "P1",
      items: ["I1", "I3"],
    });
  });

  it("lists no items for a visit whose items are all voided", () => {
    const state = reduce(
      visitWith(
        mk("a", 6, { type: "voided", target: "a:3" }),
        mk("a", 7, { type: "voided", target: "a:4" }),
        mk("a", 8, { type: "voided", target: "a:5" }),
      ),
    );
    const r = visitReceipt(state, "a:2", AT)!;
    expect(r.items).toEqual([]);
  });

  it("returns null for an unknown or voided visit", () => {
    expect(visitReceipt(reduce(visitWith()), "a:99", AT)).toBeNull();
    const voided = reduce(visitWith(mk("a", 6, { type: "voided", target: "a:2" })));
    expect(visitReceipt(voided, "a:2", AT)).toBeNull();
  });

  it("names the session Session when it has no name", () => {
    const state = reduce(visitWith().slice(1));
    expect(state.name).toBeNull();
    expect(visitReceipt(state, "a:2", AT)?.session).toBe("Session");
  });
});
