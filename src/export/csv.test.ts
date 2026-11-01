import { expect, test } from "vite-plus/test";
import { buildCsv } from "./csv";

test("CSV has a BOM, a header, CRLF lines, quoting and a formula guard", () => {
  const at = new Date(2026, 9, 31, 14, 5, 12).getTime();
  const csv = buildCsv([
    { patron: "P1", item: "-5", scannedAt: at, clerk: "Ann", session: 'Smith, J "Spring"' },
    { patron: "+P2", item: "", scannedAt: null, clerk: "=1+1", session: "@x" },
  ]);
  expect(csv).toBe(
    "﻿Patron,Item,Scanned at,Clerk,Session\r\n" +
      `P1,'-5,2026-10-31 14:05:12,Ann,"Smith, J ""Spring"""\r\n` +
      "'+P2,,,'=1+1,'@x\r\n",
  );
});
