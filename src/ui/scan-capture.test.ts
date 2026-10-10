import { describe, expect, it, vi } from "vite-plus/test";
import { createScanCapture, type KeyLike } from "./scan-capture";

const field = { closest: (s: string) => (s.includes("textarea") ? {} : null) };
const button = { closest: () => null };

function key(k: string, target: unknown = button, mods: Partial<KeyLike> = {}) {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: target as EventTarget,
    preventDefault: vi.fn(),
    ...mods,
  };
}

function type(handler: (e: KeyLike) => void, text: string, target?: unknown) {
  const events = text.split("").map((c) => key(c === "\n" ? "Enter" : c, target));
  for (const e of events) handler(e);
  return events;
}

describe("createScanCapture", () => {
  it("collects keys outside text fields and emits the code on Enter", () => {
    const onScan = vi.fn();
    const h = createScanCapture(onScan);
    const events = type(h, "P1\nI 2\n");
    expect(onScan.mock.calls).toEqual([["P1"], ["I 2"]]);
    for (const e of events) expect(e.preventDefault).toHaveBeenCalled();
  });

  it("leaves typing in text fields alone", () => {
    const onScan = vi.fn();
    const h = createScanCapture(onScan);
    const events = type(h, "OC1:abc\n", field);
    expect(onScan).not.toHaveBeenCalled();
    for (const e of events) expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("a lone Enter or Space still presses a focused button", () => {
    const onScan = vi.fn();
    const h = createScanCapture(onScan);
    const [space, enter] = type(h, " \n");
    expect(space!.preventDefault).not.toHaveBeenCalled();
    expect(enter!.preventDefault).not.toHaveBeenCalled();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores shortcuts and drops a half-typed code when focus moves into a field", () => {
    const onScan = vi.fn();
    const h = createScanCapture(onScan);
    h(key("c", button, { ctrlKey: true }));
    type(h, "P1");
    h(key("x", field));
    type(h, "\n");
    expect(onScan).not.toHaveBeenCalled();
  });
});
