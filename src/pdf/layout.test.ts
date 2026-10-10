import { test, expect, describe } from "vite-plus/test";
import type { Block } from "./blocks";
import { GEOMETRY as g, layout, type Placed } from "./layout";
import { code39Width } from "./code39";

const num = (n: number, len = 14) => String(n).padStart(len, "0");
const blk = (n: number, items: number, len = 14): Block => ({
  patron: num(n, len),
  items: Array.from({ length: items }, (_, i) => num(n * 1000 + i, len)),
  clerks: ["A", "B"],
  firstAt: n,
});
const barcodes = (els: Placed[]) =>
  els.filter((e): e is Extract<Placed, { kind: "barcode" }> => e.kind === "barcode");

describe("layout", () => {
  test("14-digit barcodes give 3 columns; a 20-char one gives 2", () => {
    const blocks = Array.from({ length: 20 }, (_, i) => blk(i + 1, 3));
    expect(layout(blocks, ["x"]).columns).toBe(3);
    blocks[4].items[1] = "A".repeat(20);
    expect(layout(blocks, ["x"]).columns).toBe(2);
  });
  test("everything stays inside the content area and column", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => blk(i + 1, (i % 7) + 1));
    const r = layout(blocks, ["a", "b", "c"]);
    expect(r.pages).toBeGreaterThan(1);
    for (const e of r.elements) {
      if (e.kind === "page-header") continue;
      expect(e.x).toBeGreaterThanOrEqual(g.margin - 1e-9);
      expect(e.y).toBeGreaterThanOrEqual(g.margin + g.headerH - 1e-9);
      if (e.kind === "barcode") {
        expect(e.x + code39Width(e.text)).toBeLessThanOrEqual(g.pageW - g.margin + 1e-9);
        expect(
          e.y + g.patronRowH * (e.role === "patron" ? 1 : 0) + (e.role === "item" ? g.itemRowH : 0),
        ).toBeLessThanOrEqual(g.pageH - g.margin + 1e-9);
      }
      if (e.kind === "box") {
        expect(e.x + e.w).toBeLessThanOrEqual(g.pageW - g.margin + 1e-9);
        expect(e.y + e.h).toBeLessThanOrEqual(g.pageH - g.margin + 1e-9);
      }
      if (e.kind === "caption")
        expect(e.y + g.captionH).toBeLessThanOrEqual(g.pageH - g.margin + 1e-9);
      if (e.kind === "summary")
        expect(e.y + e.lines.length * 0.2).toBeLessThanOrEqual(g.pageH - g.margin + 1e-9);
    }
  });
  test("blocks that fit are never split across columns", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => blk(i + 1, (i % 9) + 1));
    const r = layout(blocks, []);
    const colOf = (x: number) => Math.round((x - g.margin) / (r.colW + g.gutter));
    for (const b of blocks) {
      const cols = new Set(
        barcodes(r.elements)
          .filter((e) => e.text === b.patron || b.items.includes(e.text))
          .map((e) => `${e.page}/${colOf(e.x)}`),
      );
      expect(cols.size).toBe(1);
    }
  });
  test("a 60-item block continues with repeated patron barcode; items once each", () => {
    const b = blk(1, 60);
    const r = layout([b, blk(2, 2)], ["s"]);
    const patrons = barcodes(r.elements).filter((e) => e.text === b.patron);
    expect(patrons.length).toBeGreaterThanOrEqual(2);
    expect(patrons[0].continued).toBeUndefined();
    expect(patrons.slice(1).every((p) => p.continued === true)).toBe(true);
    const items = barcodes(r.elements).filter((e) => e.role === "item" && b.items.includes(e.text));
    expect(items.map((i) => i.text).sort()).toEqual([...b.items].sort());
    expect(r.elements.filter((e) => e.kind === "box").length).toBe(patrons.length + 1);
  });
  test("zero blocks: one page, summary only", () => {
    const r = layout([], ["Totals"]);
    expect(r.pages).toBe(1);
    expect(r.elements.map((e) => e.kind).sort()).toEqual(["page-header", "summary"]);
  });
  test("one page-header per page, pages = highest page", () => {
    const r = layout(
      Array.from({ length: 60 }, (_, i) => blk(i + 1, 5)),
      ["s"],
    );
    const headers = r.elements.filter((e) => e.kind === "page-header").map((e) => e.page);
    expect(headers).toEqual(Array.from({ length: r.pages }, (_, i) => i + 1));
    expect(Math.max(...r.elements.map((e) => e.page))).toBe(r.pages);
  });
  test("summary moves on when it does not fit", () => {
    const blocks = [blk(1, 24)];
    const r = layout(
      blocks,
      Array.from({ length: 10 }, () => "l"),
    );
    const s = r.elements.find((e) => e.kind === "summary")!;
    expect(s.y).toBeCloseTo(g.margin + g.headerH);
  });
});
