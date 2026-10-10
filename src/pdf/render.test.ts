import { test, expect, describe } from "vite-plus/test";
import type { SessionState } from "../log/types";
import { buildScannerCard, buildSessionPdf, renderScannerCard, renderSessionPdf } from "./render";
import { code39Modules } from "./code39";

const visit = (patron: string, items: string[], employee = "Zed") => ({
  patron,
  employee,
  at: 1,
  voided: false,
  items: items.map((barcode) => ({ barcode, employee, voided: false })),
});

function state(visits: unknown[], name: string | null = "Spring Sale"): SessionState {
  return {
    sessionId: "s",
    name,
    closed: false,
    visits,
    patronIndex: new Map(),
    totals: { patrons: 3, items: 4 },
    perClerk: { Zed: { patrons: 1, items: 1 }, Amy: { patrons: 2, items: 3 } },
  } as unknown as SessionState;
}

const raw = (doc: { output(t: "arraybuffer"): ArrayBuffer }) =>
  new TextDecoder("latin1").decode(doc.output("arraybuffer"));
const texts = (s: string) => [...s.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1]);
const rects = (s: string) => (s.match(/ re\b/g) ?? []).length;

describe("render", () => {
  const st = state([
    visit("P0001", ["I0001", "I0002"]),
    visit("P0002", ["I0003"]),
    visit("P0003", ["I0004"]),
  ]);
  const date = new Date(2026, 9, 10);

  test("session pdf contains each barcode text, header and summary", () => {
    const t = texts(raw(buildSessionPdf(st, { date }, false)));
    for (const s of ["P0001", "P0002", "P0003", "I0001", "I0002", "I0003", "I0004"]) {
      expect(t.filter((x) => x === s)).toHaveLength(1);
    }
    expect(t).toContain("Spring Sale - 2026-10-10 - Page 1 of 1");
    expect(t).toContain("Patrons: 3");
    expect(t).toContain("Items: 4");
    expect(t.indexOf("Amy: 2 patrons, 3 items")).toBeLessThan(t.indexOf("Zed: 1 patron, 1 item"));
  });

  test("barcode A is one rect per bar run", () => {
    const s = raw(buildSessionPdf(state([visit("A", [])]), { date }, false));
    const runs = code39Modules("A").match(/1+/g)!.length;
    // plus one stroked box for the (empty) item box
    expect(rects(s) - 1).toBe(runs);
  });

  test("falls back to 'Session' and renders blobs", () => {
    const t = texts(raw(buildSessionPdf(state([], null), { date }, false)));
    expect(t).toContain("Session - 2026-10-10 - Page 1 of 1");
    expect(renderSessionPdf(st, { date }).size).toBeGreaterThan(100);
  });

  test("scanner card", () => {
    const t = texts(raw(buildScannerCard(false)));
    for (const s of ["OC-END", "OC-VOIDLAST", "End patron", "Void last item"]) {
      expect(t).toContain(s);
    }
    expect(t).toContain("Offline Checkout - Scanner card");
    expect(renderScannerCard().type).toBe("application/pdf");
  });
});
