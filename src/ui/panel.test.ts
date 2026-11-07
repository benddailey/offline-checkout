import { describe, expect, it } from "vite-plus/test";
import { clampOffset } from "./panel";

describe("clampOffset", () => {
  const home = { left: 128, right: 1152, bottom: 600 };

  it("keeps a move that stays inside the window", () => {
    expect(clampOffset({ x: -50, y: 40 }, home, 1280, 720)).toEqual({ x: -50, y: 40 });
  });

  it("stops the panel at the window edges and below the status bar", () => {
    expect(clampOffset({ x: -500, y: -30 }, home, 1280, 720)).toEqual({ x: -128, y: 12 });
    expect(clampOffset({ x: 500, y: 500 }, home, 1280, 720)).toEqual({ x: 128, y: 120 });
  });

  it("leaves a gap under the status bar only when the window has room", () => {
    expect(clampOffset({ x: 0, y: 0 }, home, 1280, 720)).toEqual({ x: 0, y: 12 });
    expect(clampOffset({ x: 0, y: 0 }, { ...home, bottom: 715 }, 1280, 720)).toEqual({
      x: 0,
      y: 5,
    });
  });

  it("can't move a panel down when it already fills the window's height", () => {
    expect(clampOffset({ x: 0, y: 80 }, { ...home, bottom: 900 }, 1280, 720)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
