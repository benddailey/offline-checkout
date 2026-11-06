import { describe, expect, it } from "vite-plus/test";
import { dev, mk, SID } from "../log/helpers.test-util";
import { MAX_NAME } from "../log/limits";
import { reduce } from "../log/reduce";
import type { ImportedBody, LogRecord } from "../log/types";
import { isLogRecord } from "../log/validate";
import { vectorOf } from "../log/vector";
import { IMPORTED_CLERK, planImport, type ImportSource } from "./plan";
import type { FileFormat, FileSource, ImportRow } from "./rows";
import { sessionSource } from "./session";

const SRC = "ses0000002";
const here = dev("h");
const NOW = 9_000_000;

function row(
  patron: string,
  item: string,
  scannedAt: number | null,
  clerk = "Ann",
  workstation = "Desk 1",
): ImportRow {
  return { patron, item, scannedAt, clerk, workstation };
}

function file(name: string, rows: ImportRow[], format: FileFormat = "csv"): FileSource {
  return { kind: "file", name, format, rows };
}

function plan(sources: ImportSource[], existing: LogRecord[] = []) {
  let n = 0;
  return planImport(sources, existing, {
    sessionId: SID,
    newDeviceId: () => `f${String(++n).padStart(9, "0")}`,
    now: NOW,
  });
}

const session = (raw: LogRecord[], name = "Friday") =>
  sessionSource({ sessionId: SRC, name }, raw, SID);

const scanned = (records: LogRecord[]) =>
  records.flatMap((r) => (r.type === "item-scanned" ? [r] : []));

/** A visit in the target session for each patron/item pair. */
function visit(deviceId: string, patron: string, ...items: string[]): LogRecord[] {
  const started = mk(deviceId, 1, { type: "patron-started", patron });
  return [
    started,
    ...items.map((item, i) =>
      mk(deviceId, i + 2, { type: "item-scanned", visitId: `${deviceId}:1`, item }),
    ),
  ];
}

const auditRecords = (audits: ImportedBody[]): LogRecord[] =>
  audits.map((body, i) => mk(here, 100 + i, body));

describe("files", () => {
  it("makes contiguous records per file", () => {
    const p = plan([
      file("a.csv", [row("P1", "I1", 5000), row("P1", "I2", 3000), row("P2", "I3", 7000)]),
      file("b.csv", [row("P3", "I4", 8000)]),
    ]);
    const [first, second] = p.sources;
    expect(first!.records.map((r) => r.deviceId)).toEqual(Array(7).fill("f000000001"));
    expect(first!.records.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(first!.records.map((r) => [r.type, r.at])).toEqual([
      ["patron-started", 3000],
      ["item-scanned", 5000],
      ["item-scanned", 3000],
      ["patron-ended", 5000],
      ["patron-started", 7000],
      ["item-scanned", 7000],
      ["patron-ended", 7000],
    ]);
    expect(second!.records.map((r) => [r.deviceId, r.seq])).toEqual([
      ["f000000002", 1],
      ["f000000002", 2],
      ["f000000002", 3],
    ]);
    expect(p.records.every((r) => r.imported === true && r.sessionId === SID)).toBe(true);
    expect(p.records.every(isLogRecord)).toBe(true);
    expect(vectorOf(p.records)).toEqual({ f000000001: 7, f000000002: 3 });
    expect(reduce(p.records).visits.every((v) => v.ended && v.imported)).toBe(true);
    expect(reduce(p.records).totals).toEqual({ patrons: 3, items: 4 });
  });

  it("keeps each row's clerk and workstation, and uses Imported when none", () => {
    const p = plan([
      file("a.csv", [
        row("P1", "I1", 1000, "Ann", "Desk 1"),
        row("P1", "I2", 2000, "Bob", "Desk 2"),
      ]),
      file("b.txt", [row("P2", "I3", 3000, "", "")], "xacts"),
    ]);
    const [i1, i2, i3] = scanned(p.records);
    expect(i1).toMatchObject({ employee: "Ann", workstation: "Desk 1" });
    expect(i2).toMatchObject({ employee: "Bob", workstation: "Desk 2" });
    expect(i3!.employee).toBe(IMPORTED_CLERK);
    expect("workstation" in i3!).toBe(false);
    // The visit opens with its earliest row's clerk and closes with its latest row's.
    expect(p.sources[0]!.records[0]).toMatchObject({ employee: "Ann", workstation: "Desk 1" });
    expect(p.sources[0]!.records[3]).toMatchObject({ employee: "Bob", workstation: "Desk 2" });
    expect(
      p.records.filter((r) => r.deviceId === "f000000002").every((r) => r.employee === "Imported"),
    ).toBe(true);
  });

  it("counts rows already here, whatever their time", () => {
    const p = plan(
      [file("a.csv", [row("P1", "I1", 99_000), row("P1", "I2", 2000)])],
      visit(here, "P1", "I1"),
    );
    const s = p.sources[0]!;
    expect(s.alreadyHere).toBe(1);
    expect(s.adds).toEqual({ patrons: 0, items: 1 });
    expect(scanned(s.records).map((r) => r.item)).toEqual(["I2"]);
  });

  it("doesn't add rows voided here", () => {
    const existing = [
      ...visit(here, "P1", "I1"),
      mk(here, 3, { type: "voided", target: `${here}:2` }),
    ];
    const s = plan([file("a.csv", [row("P1", "I1", 1000)])], existing).sources[0]!;
    expect(s.voidedHere).toBe(1);
    expect(s.alreadyHere).toBe(0);
    expect(s.adds.items).toBe(0);
    expect(s.records).toEqual([]);
    expect(s.changed).toBe(false);
  });

  it("treats a pair in a voided visit as voided here", () => {
    const existing = [
      ...visit(here, "P1", "I1"),
      mk(here, 3, { type: "voided", target: `${here}:1` }),
    ];
    const s = plan([file("a.csv", [row("P1", "I1", 1000)])], existing).sources[0]!;
    expect(s.voidedHere).toBe(1);
    expect(s.records).toEqual([]);
  });

  it("counts a pair both voided and live as already here", () => {
    const other = dev("o");
    const existing = [
      ...visit(here, "P1", "I1"),
      mk(here, 3, { type: "voided", target: `${here}:2` }),
      ...visit(other, "P1", "I1"),
    ];
    const s = plan([file("a.csv", [row("P1", "I1", 1000)])], existing).sources[0]!;
    expect(s.alreadyHere).toBe(1);
    expect(s.voidedHere).toBe(0);
    expect(s.records).toEqual([]);
  });

  it("prefers a row with clerk details, then the earliest", () => {
    const xacts = file("a.txt", [row("P1", "I1", 1000, "", "")], "xacts");
    const xlsx = file("a.xlsx", [row("P1", "I1", 2000, "Ann", "Desk 1")], "xlsx");
    const detailed = plan([xacts, xlsx]);
    expect(scanned(detailed.records)).toHaveLength(1);
    expect(scanned(detailed.records)[0]).toMatchObject({ employee: "Ann", at: 2000 });
    expect(detailed.sources[0]).toMatchObject({
      adds: { patrons: 0, items: 0 },
      alreadyHere: 1,
      changed: false,
    });
    expect(detailed.sources[1]).toMatchObject({ adds: { patrons: 1, items: 1 }, alreadyHere: 0 });

    const csv = file("a.csv", [row("P1", "I1", 3000, "Bob", "Desk 2")]);
    const earliest = plan([csv, xlsx]);
    expect(scanned(earliest.records)).toHaveLength(1);
    expect(scanned(earliest.records)[0]).toMatchObject({ employee: "Ann", at: 2000 });

    const reimported = file("b.csv", [row("P1", "I1", 500, IMPORTED_CLERK, "")]);
    expect(scanned(plan([reimported, xlsx]).records)[0]).toMatchObject({ employee: "Ann" });
  });

  it("three formats of one session add each checkout once", () => {
    const rows = [row("P1", "I1", 1000), row("P1", "I2", 2000), row("P2", "I3", 3000)];
    const bare = rows.map((r) => ({ ...r, clerk: "", workstation: "" }));
    const p = plan([
      file("a.xlsx", rows, "xlsx"),
      file("a.csv", rows, "csv"),
      file("a.txt", bare, "xacts"),
    ]);
    expect(scanned(p.records)).toHaveLength(3);
    expect(p.sources[0]!.adds).toEqual({ patrons: 2, items: 3 });
    for (const later of p.sources.slice(1)) {
      expect(later.adds).toEqual({ patrons: 0, items: 0 });
      expect(later.alreadyHere).toBe(3);
      expect(later.changed).toBe(false);
      expect(later.records).toEqual([]);
    }
    expect(p.audits).toHaveLength(1);
  });

  it("blank-item patron becomes an empty visit unless already in the session", () => {
    const fresh = plan([file("a.csv", [row("P1", "", null)])]);
    expect(fresh.records.map((r) => r.type)).toEqual(["patron-started", "patron-ended"]);
    expect(fresh.sources[0]!.adds).toEqual({ patrons: 1, items: 0 });
    expect(fresh.sources[0]!.alreadyHere).toBe(0);
    expect(reduce(fresh.records).visits[0]).toMatchObject({ patron: "P1", ended: true });

    expect(plan([file("a.csv", [row("P1", "", null)])], visit(here, "P1")).records).toEqual([]);

    const voidedVisit = [
      ...visit(here, "P1"),
      mk(here, 2, { type: "voided", target: `${here}:1` }),
    ];
    expect(plan([file("a.csv", [row("P1", "", null)])], voidedVisit).records).toEqual([]);

    const inBatch = plan([
      file("a.csv", [row("P1", "", null)]),
      file("b.csv", [row("P1", "I1", 1000)]),
    ]);
    expect(inBatch.sources[0]!.records).toEqual([]);
    expect(inBatch.sources[0]!.changed).toBe(false);
    expect(inBatch.sources[1]!.adds).toEqual({ patrons: 1, items: 1 });

    const twice = plan([
      file("a.csv", [row("P1", "", null)]),
      file("b.csv", [row("P1", "", null)]),
    ]);
    expect(twice.records.map((r) => r.type)).toEqual(["patron-started", "patron-ended"]);
  });

  it("gives a blank-item visit the file's earliest time, or now", () => {
    const withItems = plan([
      file("a.csv", [row("P1", "I1", 4000), row("P2", "", null), row("P3", "I2", 2000)]),
    ]);
    const started = withItems.records.find(
      (r) => r.type === "patron-started" && r.patron === "P2",
    )!;
    expect(started.at).toBe(2000);
    const alone = plan([file("a.csv", [row("P2", "", null)])]);
    expect(alone.records.map((r) => r.at)).toEqual([NOW, NOW]);
  });

  it("clamps long clerk, workstation and file names", () => {
    const long = "x".repeat(MAX_NAME + 50);
    const p = plan([
      file(`${long}.csv`, [row("P1", "I1", 1000, long, long), row("P2", "", null, long, long)]),
    ]);
    expect(p.records.length).toBeGreaterThan(0);
    expect([...p.records, ...auditRecords(p.audits)].every(isLogRecord)).toBe(true);
    expect(p.audits[0]!.name).toHaveLength(MAX_NAME);
  });

  it("plans a header-only file as changing nothing", () => {
    const p = plan([file("empty.csv", [])]);
    expect(p.sources[0]).toMatchObject({
      records: [],
      adds: { patrons: 0, items: 0 },
      alreadyHere: 0,
      voidedHere: 0,
      voidedBySource: 0,
      range: null,
      changed: false,
    });
    expect(p.audits).toEqual([]);
    expect(p.anythingNew).toBe(false);
  });
});

describe("sessions", () => {
  const raw = [
    mk(dev("a"), 1, { type: "session-created", name: "Friday" }),
    mk(dev("a"), 2, { type: "patron-started", patron: "P1" }),
    mk(dev("a"), 3, { type: "item-scanned", visitId: `${dev("a")}:2`, item: "I1" }),
  ];

  it("stores nothing the second time", async () => {
    const source = await session(raw);
    const p = plan([source], source.records);
    expect(p.anythingNew).toBe(false);
    expect(p.records).toEqual([]);
    expect(p.audits).toEqual([]);
    expect(p.sources[0]).toMatchObject({
      changed: false,
      adds: { patrons: 0, items: 0 },
      alreadyHere: 1,
    });
  });

  it("stores only the new records after more scans", async () => {
    const before = await session(raw);
    const more = mk(dev("a"), 4, { type: "item-scanned", visitId: `${dev("a")}:2`, item: "I2" });
    const p = plan([await session([...raw, more])], before.records);
    expect(p.records).toHaveLength(1);
    expect(p.records[0]).toMatchObject({ seq: 4, item: "I2" });
    expect(p.sources[0]).toMatchObject({
      adds: { patrons: 0, items: 1 },
      alreadyHere: 1,
      changed: true,
    });
  });

  it("a source with only new gaps changes nothing", async () => {
    const before = await session(raw);
    const closed = mk(dev("a"), 4, { type: "session-closed" });
    const p = plan([await session([...raw, closed])], before.records);
    expect(p.sources[0]).toMatchObject({ records: [], changed: false });
    expect(p.anythingNew).toBe(false);
    expect(p.audits).toEqual([]);
  });

  it("stores waiting gaps with the next real change, so seq stays contiguous", async () => {
    const before = await session(raw);
    const exported = mk(dev("a"), 4, { type: "exported", kind: "csv" });
    const more = mk(dev("a"), 5, { type: "item-scanned", visitId: `${dev("a")}:2`, item: "I2" });
    const p = plan([await session([...raw, exported, more])], before.records);
    expect(p.records.map((r) => [r.seq, r.type])).toEqual([
      [4, "import-gap"],
      [5, "item-scanned"],
    ]);
    const device = p.records[0]!.deviceId;
    expect(vectorOf([...before.records, ...p.records])[device]).toBe(5);
  });

  it("counts already-here pairs", async () => {
    const p = plan([await session(raw)], visit(here, "P1", "I1"));
    expect(p.sources[0]!.alreadyHere).toBe(1);
    expect(p.sources[0]!.adds).toEqual({ patrons: 0, items: 0 });
  });

  it("counts a new record that adds nothing as a change", async () => {
    const p = plan([await session(raw)], visit(here, "P1", "I1"));
    expect(p.sources[0]!.changed).toBe(true);
    expect(p.records).toHaveLength(3);
    expect(p.audits).toEqual([
      { type: "imported", source: "session", name: "Friday", patrons: 0, items: 0 },
    ]);
    expect(p.anythingNew).toBe(true);
  });

  it("brings back an item voided here that is live in the source", async () => {
    const existing = [
      ...visit(here, "P1", "I1"),
      mk(here, 3, { type: "voided", target: `${here}:2` }),
    ];
    const s = plan([await session(raw)], existing).sources[0]!;
    expect(s.adds).toEqual({ patrons: 0, items: 1 });
    expect(s.voidedHere).toBe(0);
    expect(s.alreadyHere).toBe(0);
  });

  it("a void added later in the source applies", async () => {
    const before = await session(raw);
    const voided = mk(dev("a"), 4, { type: "voided", target: `${dev("a")}:3` });
    const p = plan([await session([...raw, voided])], before.records);
    expect(p.sources[0]).toMatchObject({
      adds: { patrons: 0, items: 0 },
      voidedBySource: 1,
      changed: true,
    });
    expect(p.audits).toEqual([
      { type: "imported", source: "session", name: "Friday", patrons: 0, items: 0 },
    ]);
    expect(reduce([...before.records, ...p.records]).totals.items).toBe(0);
  });

  it("clamps a long session name in its audit", async () => {
    const p = plan([await session(raw, "x".repeat(MAX_NAME + 50))]);
    expect(auditRecords(p.audits).every(isLogRecord)).toBe(true);
  });
});

it("adds are by source, in order", async () => {
  const p = plan([
    file("a.csv", [row("P1", "I1", 1000)]),
    file("b.csv", [row("P1", "I1", 1000), row("P1", "I2", 2000), row("P2", "I3", 3000)]),
  ]);
  expect(p.sources[0]!.adds).toEqual({ patrons: 1, items: 1 });
  expect(p.sources[1]!.adds).toEqual({ patrons: 1, items: 2 });
  expect(p.sources[1]!.alreadyHere).toBe(1);

  const friday = await session(visit(dev("a"), "P1", "I1"));
  const mixed = plan([friday, file("a.csv", [row("P1", "I1", 1000)])]);
  expect(mixed.sources[0]!.adds).toEqual({ patrons: 1, items: 1 });
  expect(mixed.sources[1]).toMatchObject({
    adds: { patrons: 0, items: 0 },
    alreadyHere: 1,
    records: [],
    changed: false,
  });

  const twice = plan([friday, friday]);
  expect(twice.sources[1]).toMatchObject({ records: [], changed: false, alreadyHere: 1 });
});

it("counts barcodes also on another patron, only if new", () => {
  const onP1 = visit(here, "P1", "I1");
  expect(plan([file("a.csv", [row("P2", "I1", 1000)])], onP1).alsoOnOtherPatron).toBe(1);
  expect(plan([file("a.csv", [row("P2", "I2", 1000)])], onP1).alsoOnOtherPatron).toBe(0);

  const onBoth = [...onP1, ...visit(dev("o"), "P2", "I1")];
  expect(plan([file("a.csv", [row("P3", "I1", 1000)])], onBoth).alsoOnOtherPatron).toBe(0);

  const voided = [...onP1, mk(here, 3, { type: "voided", target: `${here}:2` })];
  expect(plan([file("a.csv", [row("P2", "I1", 1000)])], voided).alsoOnOtherPatron).toBe(0);

  const inBatch = plan([file("a.csv", [row("P1", "I9", 1000), row("P2", "I9", 2000)])]);
  expect(inBatch.alsoOnOtherPatron).toBe(1);
});

it("gives the date range from items", async () => {
  const p = plan([
    file("a.csv", [row("P1", "I1", 5000), row("P2", "", null), row("P3", "I2", 3000)]),
  ]);
  expect(p.sources[0]!.range).toEqual({ from: 3000, to: 5000 });
  expect(plan([file("a.csv", [row("P2", "", null)])]).sources[0]!.range).toBeNull();

  const scans = await session(visit(dev("a"), "P1", "I1", "I2"));
  expect(plan([scans]).sources[0]!.range).toEqual({ from: 2000, to: 3000 });
  const empty = await session(visit(dev("a"), "P1"));
  expect(plan([empty]).sources[0]!.range).toBeNull();
});

it("writes one audit per changed source, with what it added", async () => {
  const friday = await session(visit(dev("a"), "P1", "I1", "I2"));
  const p = plan([
    friday,
    file("sat.xlsx", [row("P2", "I3", 1000)], "xlsx"),
    file("same.csv", [row("P2", "I3", 1000)]),
  ]);
  expect(p.audits).toEqual([
    { type: "imported", source: "session", name: "Friday", patrons: 1, items: 2 },
    { type: "imported", source: "file", name: "sat.xlsx", patrons: 1, items: 1 },
  ]);
  expect(p.anythingNew).toBe(true);
  expect(p.records).toEqual(p.sources.flatMap((s) => s.records));
});
