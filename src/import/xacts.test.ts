import { expect, test } from "vite-plus/test";
import { buildXacts } from "../export/xacts";
import { parseXacts } from "./xacts";

const at = new Date(2026, 9, 31, 14, 5, 12, 345).getTime();
const base = {
  timestamp: Math.floor(at / 1000),
  type: "checkout",
  delta: 0,
  patron_barcode: "P1",
  barcode: "I1",
  checkout_time: new Date(at).toISOString(),
};
const line = (o: object) => `${JSON.stringify(o)}\n`;

test("round-trips buildXacts", () => {
  const text = buildXacts([
    { patron: "P1", item: "I1", scannedAt: at, clerk: "Ann", workstation: "D", session: "S" },
    {
      patron: "P2",
      item: "I2",
      scannedAt: at + 5000,
      clerk: "Ann",
      workstation: "D",
      session: "S",
    },
  ]);
  expect(parseXacts(text)).toEqual([
    { rowNumber: 1, patron: "P1", item: "I1", scannedAt: at, clerk: "", workstation: "" },
    { rowNumber: 2, patron: "P2", item: "I2", scannedAt: at + 5000, clerk: "", workstation: "" },
  ]);
});

test("rejects other types, extra keys, missing keys, bad JSON", () => {
  const notOurs = "Line 1: this is not a checkout the app wrote.";
  const { type: _t, ...missing } = base;
  for (const bad of [
    line({ ...base, type: "checkin" }),
    line({ ...base, due_date: "2026-11-01" }),
    line(missing),
    line({ ...base, delta: 1 }),
    "{not json\n",
    "[1]\n",
  ]) {
    expect(() => parseXacts(bad)).toThrow(notOurs);
  }
});

test("rejects timestamp and checkout_time more than a second apart", () => {
  expect(() => parseXacts(line({ ...base, timestamp: base.timestamp + 5 }))).toThrow(
    "Line 1: timestamp and checkout_time differ.",
  );
});
