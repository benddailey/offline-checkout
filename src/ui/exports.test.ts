import { describe, expect, test } from "vite-plus/test";
import type { ExportState, ImportState } from "../log/types";
import { evergreenStale, exportLines } from "./exports";

const time = () => "3:12 PM";
const ex = (kind: ExportState["kind"], at: number, workstation = "Front desk"): ExportState => ({
  kind,
  at,
  employee: "Ann",
  workstation,
});

describe("exportLines", () => {
  test("says so when nothing was downloaded", () => {
    expect(exportLines([], time).map((l) => l.text)).toEqual([
      "No PDF download recorded",
      "No CSV file download recorded",
      "No Excel file download recorded",
      "No Evergreen file download recorded",
    ]);
  });

  test("uses the latest export of a kind", () => {
    const lines = exportLines([ex("xacts", 2, "Back desk"), ex("xacts", 5), ex("xacts", 3)], time);
    expect(lines[3]).toEqual({
      kind: "xacts",
      text: "Evergreen file: downloaded 3:12 PM by Ann (Front desk)",
    });
  });

  test("omits the parentheses without a workstation", () => {
    expect(exportLines([ex("pdf", 1, "")], time)[0]!.text).toBe("PDF: downloaded 3:12 PM by Ann");
  });
});

const imp = (at: number): ImportState => ({
  source: "file",
  name: "friday.xlsx",
  patrons: 1,
  items: 1,
  at,
  employee: "Ann",
  workstation: "Front desk",
});

describe("evergreenStale", () => {
  test("is stale when an import follows the last Evergreen download", () => {
    expect(evergreenStale({ exports: [ex("xacts", 2)], imports: [imp(3)] })).toBe(true);
    expect(evergreenStale({ exports: [ex("xacts", 1), ex("xacts", 2)], imports: [imp(3)] })).toBe(
      true,
    );
  });

  test("isn't stale with no download, no import, or a later download", () => {
    expect(evergreenStale({ exports: [], imports: [imp(3)] })).toBe(false);
    expect(evergreenStale({ exports: [ex("xacts", 2)], imports: [] })).toBe(false);
    expect(evergreenStale({ exports: [ex("xacts", 2), ex("xacts", 4)], imports: [imp(3)] })).toBe(
      false,
    );
  });

  test("only Evergreen downloads count", () => {
    expect(evergreenStale({ exports: [ex("csv", 1)], imports: [imp(3)] })).toBe(false);
    expect(evergreenStale({ exports: [ex("xacts", 2), ex("csv", 5)], imports: [imp(3)] })).toBe(
      true,
    );
  });
});
