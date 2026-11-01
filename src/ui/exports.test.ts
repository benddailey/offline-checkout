import { describe, expect, test } from "vite-plus/test";
import type { ExportState } from "../log/types";
import { exportLines } from "./exports";

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
