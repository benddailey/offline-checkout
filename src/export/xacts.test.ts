import { expect, test } from "vite-plus/test";
import { buildXacts } from "./xacts";

test("one Evergreen offline checkout per item, as JSON lines; patrons with no items are skipped", () => {
  const xacts = buildXacts([
    {
      patron: "P1",
      item: "I1",
      scannedAt: 1793460312999,
      clerk: "Ann",
      workstation: "",
      session: "Outage",
    },
    { patron: "P2", item: "", scannedAt: null, clerk: "Ann", workstation: "", session: "Outage" },
    {
      patron: "P3",
      item: "I2",
      scannedAt: 1793460400000,
      clerk: "Ben",
      workstation: "",
      session: "Outage",
    },
  ]);
  expect(xacts).toBe(
    '{"timestamp":1793460312,"type":"checkout","delta":0,"patron_barcode":"P1","barcode":"I1",' +
      '"checkout_time":"2026-10-31T15:25:12.999Z"}\n' +
      '{"timestamp":1793460400,"type":"checkout","delta":0,"patron_barcode":"P3","barcode":"I2",' +
      '"checkout_time":"2026-10-31T15:26:40.000Z"}\n',
  );
  for (const line of xacts.trimEnd().split("\n")) expect(JSON.parse(line)).toBeTypeOf("object");
});

test("no items gives an empty file", () => {
  expect(buildXacts([])).toBe("");
});
