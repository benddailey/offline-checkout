import { describe, expect, test } from "vite-plus/test";
import type { ImportPlan, SourcePlan } from "../import/plan";
import type { FileFormat } from "../import/rows";
import type { SessionSource } from "../import/session";
import type { ImportState } from "../log/types";
import { importLine, previewWarnings, sourceHeading, sourceLine } from "./import-preview";

const DOUBLE_UPLOAD =
  "If any of these checkouts are already in Evergreen, the new Evergreen file would check them out again.";

const time = (at: number) => `time-${at}`;
const date = (at: number) => (at < 100 ? "Nov 6" : "Nov 7");

const fileSource = (format: FileFormat, name = "friday.xlsx"): SourcePlan["source"] => ({
  kind: "file",
  name,
  format,
  rows: [],
});

const sessionSource = (over: Partial<SessionSource> = {}): SessionSource => ({
  kind: "session",
  name: "Friday",
  records: [],
  stillOpen: false,
  evergreen: null,
  ...over,
});

const sourcePlan = (over: Partial<SourcePlan> = {}): SourcePlan => ({
  source: fileSource("xlsx"),
  records: [],
  adds: { patrons: 0, items: 0 },
  alreadyHere: 0,
  voidedHere: 0,
  voidedBySource: 0,
  range: null,
  changed: false,
  ...over,
});

const importPlan = (sources: SourcePlan[], alsoOnOtherPatron = 0): ImportPlan => ({
  sources,
  records: [],
  audits: [],
  alsoOnOtherPatron,
  anythingNew: true,
});

describe("sourceLine", () => {
  test("gives every part that applies", () => {
    expect(
      sourceLine(
        sourcePlan({
          adds: { patrons: 118, items: 240 },
          alreadyHere: 6,
          voidedHere: 2,
          voidedBySource: 3,
        }),
      ),
    ).toBe(
      "Adds 118 patrons and 240 items. 6 already here. 2 voided here, not added. 3 items voided in the source.",
    );
  });

  test("uses singulars", () => {
    expect(
      sourceLine(
        sourcePlan({
          adds: { patrons: 1, items: 1 },
          alreadyHere: 1,
          voidedHere: 1,
          voidedBySource: 1,
        }),
      ),
    ).toBe(
      "Adds 1 patron and 1 item. 1 already here. 1 voided here, not added. 1 item voided in the source.",
    );
  });

  test("leaves out parts that are zero", () => {
    expect(sourceLine(sourcePlan({ adds: { patrons: 2, items: 3 } }))).toBe(
      "Adds 2 patrons and 3 items.",
    );
    expect(sourceLine(sourcePlan({ adds: { patrons: 2, items: 3 }, voidedHere: 2 }))).toBe(
      "Adds 2 patrons and 3 items. 2 voided here, not added.",
    );
  });

  test("still gives both numbers when only one of them is zero", () => {
    expect(sourceLine(sourcePlan({ adds: { patrons: 0, items: 2 } }))).toBe(
      "Adds 0 patrons and 2 items.",
    );
    expect(sourceLine(sourcePlan({ adds: { patrons: 2, items: 0 } }))).toBe(
      "Adds 2 patrons and 0 items.",
    );
  });

  test("drops the Adds sentence only when both numbers are zero", () => {
    expect(sourceLine(sourcePlan({ voidedBySource: 3 }))).toBe("3 items voided in the source.");
    expect(sourceLine(sourcePlan({ alreadyHere: 6 }))).toBe("6 already here.");
  });
});

describe("sourceHeading", () => {
  test("names each type", () => {
    const heading = (source: SourcePlan["source"]) =>
      sourceHeading(sourcePlan({ source, range: { from: 1, to: 2 } }), date);
    expect(heading(sessionSource())).toBe("Friday: Session, Nov 6");
    expect(heading(fileSource("csv", "friday.csv"))).toBe("friday.csv: CSV file, Nov 6");
    expect(heading(fileSource("xlsx"))).toBe("friday.xlsx: Excel file, Nov 6");
    expect(heading(fileSource("xacts", "friday.xacts"))).toBe(
      "friday.xacts: Evergreen file, Nov 6",
    );
  });

  test("gives the date range when the dates differ", () => {
    expect(sourceHeading(sourcePlan({ range: { from: 1, to: 200 } }), date)).toBe(
      "friday.xlsx: Excel file, Nov 6 to Nov 7",
    );
  });

  test("gives no dates without a range", () => {
    expect(sourceHeading(sourcePlan(), date)).toBe("friday.xlsx: Excel file");
  });
});

describe("previewWarnings", () => {
  test("always warns about a double upload", () => {
    expect(previewWarnings(importPlan([]), time, date)).toEqual([DOUBLE_UPLOAD]);
  });

  test("says who downloaded a source session's Evergreen file, and when", () => {
    const evergreen = (workstation: string) => ({
      kind: "xacts" as const,
      at: 5,
      employee: "Ann",
      workstation,
    });
    const plan = importPlan([
      sourcePlan({ source: sessionSource({ evergreen: evergreen("Front desk 1") }) }),
    ]);
    expect(previewWarnings(plan, time, date)).toEqual([
      DOUBLE_UPLOAD,
      "Friday had an Evergreen download at time-5 on Nov 6 by Ann (Front desk 1).",
    ]);
    const bare = importPlan([sourcePlan({ source: sessionSource({ evergreen: evergreen("") }) })]);
    expect(previewWarnings(bare, time, date)).toEqual([
      DOUBLE_UPLOAD,
      "Friday had an Evergreen download at time-5 on Nov 6 by Ann.",
    ]);
  });

  test("counts items also on another patron", () => {
    expect(previewWarnings(importPlan([], 3), time, date)).toContain(
      "3 items are also on another patron.",
    );
    expect(previewWarnings(importPlan([], 1), time, date)).toContain(
      "1 item is also on another patron.",
    );
  });

  test("warns once that Evergreen files have no clerk, only when one adds something", () => {
    const line =
      "An Evergreen file has no clerk or workstation, so its items count under Imported.";
    const adding = sourcePlan({ source: fileSource("xacts"), adds: { patrons: 0, items: 1 } });
    expect(previewWarnings(importPlan([adding, adding]), time, date)).toEqual([
      DOUBLE_UPLOAD,
      line,
    ]);
    const idle = sourcePlan({ source: fileSource("xacts"), alreadyHere: 4 });
    expect(previewWarnings(importPlan([idle]), time, date)).toEqual([DOUBLE_UPLOAD]);
    const excel = sourcePlan({ adds: { patrons: 1, items: 1 } });
    expect(previewWarnings(importPlan([excel]), time, date)).toEqual([DOUBLE_UPLOAD]);
  });

  test("warns that a source session is still open", () => {
    const plan = importPlan([sourcePlan({ source: sessionSource({ stillOpen: true }) })]);
    expect(previewWarnings(plan, time, date)).toEqual([
      DOUBLE_UPLOAD,
      "Friday is still open. Scans made there later need adding again.",
    ]);
  });
});

describe("importLine", () => {
  const imported = (over: Partial<ImportState> = {}): ImportState => ({
    source: "file",
    name: "friday.xlsx",
    patrons: 118,
    items: 240,
    at: 5,
    employee: "Ann",
    workstation: "Front desk 1",
    ...over,
  });

  test("says what was added, when and by whom", () => {
    expect(importLine(imported(), time)).toBe(
      "friday.xlsx: 118 patrons, 240 items, added time-5 by Ann (Front desk 1)",
    );
  });

  test("uses singulars and omits an empty workstation", () => {
    expect(importLine(imported({ patrons: 1, items: 1, workstation: "" }), time)).toBe(
      "friday.xlsx: 1 patron, 1 item, added time-5 by Ann",
    );
  });
});
