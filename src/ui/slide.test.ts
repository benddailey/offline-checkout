import { describe, expect, it } from "vite-plus/test";
import { slideKey, slideRelease } from "./slide";

describe("slideKey", () => {
  it("reaches 100 in five ArrowRight presses and confirms only the last", () => {
    let value = 0;
    for (let i = 1; i <= 5; i++) {
      const r = slideKey(value, "ArrowRight")!;
      expect(r.confirm).toBe(i === 5);
      value = r.value;
    }
    expect(value).toBe(100);
  });

  it("End confirms at 100", () => {
    expect(slideKey(0, "End")).toEqual({ value: 100, confirm: true });
  });

  it("Home goes to 0 and ArrowLeft stops at 0", () => {
    expect(slideKey(60, "Home")).toEqual({ value: 0, confirm: false });
    expect(slideKey(0, "ArrowLeft")).toEqual({ value: 0, confirm: false });
  });

  it("ignores Enter, Space and other keys", () => {
    expect(slideKey(40, "Enter")).toBeNull();
    expect(slideKey(40, " ")).toBeNull();
    expect(slideKey(40, "a")).toBeNull();
  });
});

describe("slideRelease", () => {
  it("is true within 8 px of the end", () => {
    expect(slideRelease(292, 300)).toBe(true);
    expect(slideRelease(270, 300)).toBe(false);
  });
});
