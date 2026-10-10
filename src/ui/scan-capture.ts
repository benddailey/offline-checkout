/** The parts of a KeyboardEvent the capture reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  preventDefault(): void;
}

const TEXT_FIELD = "input, textarea, select";

/**
 * Keydown handler for screens without a scanner box: scanner keystrokes that land outside a
 * text field are collected and handed to `onScan` on Enter. Typing in a field (a paste box, a
 * name) is left alone, and a lone Enter or Space still presses a focused button.
 */
export function createScanCapture(onScan: (code: string) => void): (e: KeyLike) => void {
  let buffer = "";
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as { closest?: (s: string) => unknown } | null;
    if (target?.closest?.(TEXT_FIELD)) {
      buffer = "";
      return;
    }
    if (e.key === "Enter") {
      const code = buffer.trim();
      buffer = "";
      if (code === "") return;
      e.preventDefault();
      onScan(code);
    } else if (e.key.length === 1) {
      if (buffer === "" && e.key === " ") return;
      e.preventDefault();
      buffer += e.key;
    }
  };
}
