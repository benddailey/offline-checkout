import { expect, test } from "vite-plus/test";
import { dateTime } from "./when";

test("a session time shows the date and the minute, not the seconds", () => {
  const text = dateTime(new Date(2026, 10, 6, 15, 4, 52).getTime());
  expect(text).toContain("2026");
  expect(text).toMatch(/\d{1,2}:04/);
  expect(text).not.toContain("52");
});
