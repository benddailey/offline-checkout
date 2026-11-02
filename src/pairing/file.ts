export type CodeLabel = "Join code" | "Reply code";

/** Local time as HH:MM. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function part(name: string | null | undefined): string[] {
  const safe = (name ?? "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe ? [safe] : [];
}

/** Unique enough for a shared drive: kind, session, workstation and the second it was saved. */
export function pairingFileName(
  label: CodeLabel,
  sessionName: string | null | undefined,
  workstation: string | null | undefined,
  at: number,
): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const kind = label === "Join code" ? "join" : "reply";
  return (
    ["offline-checkout", kind, ...part(sessionName), ...part(workstation), stamp].join("-") + ".txt"
  );
}

/** CRLF so Notepad on older Windows shows the lines. */
export function pairingFileText(label: CodeLabel, code: string, expiresAt?: number): string {
  const expiry =
    expiresAt === undefined
      ? "It works once."
      : `It works once and expires at ${clock(expiresAt)}.`;
  return [
    `Offline Checkout ${label.toLowerCase()}`,
    `Temporary file for pairing workstations. ${expiry}`,
    "Delete this file after pairing.",
    "",
    code,
    "",
  ].join("\r\n");
}

/** The first pairing code of any version in the text, or null. */
export function codeFromFile(text: string): string | null {
  return /OC\d+:[A-Za-z0-9_-]+/.exec(text)?.[0] ?? null;
}

interface SavePicker {
  showSaveFilePicker?: (o: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

/**
 * Chrome's save dialog lets staff pick a network share or flash drive. Without it the file goes to
 * Downloads. Resolves false if they cancel the dialog; rejects if writing to the chosen place fails.
 */
export async function saveTextFile(name: string, text: string): Promise<boolean> {
  const blob = new Blob([text], { type: "text/plain" });
  const picker = (window as SavePicker).showSaveFilePicker;
  if (picker) {
    let handle;
    try {
      handle = await picker({
        suggestedName: name,
        types: [{ description: "Pairing code", accept: { "text/plain": [".txt"] } }],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      handle = null; // The picker itself is unusable here (e.g. SecurityError): download instead.
    }
    if (handle) {
      // Once staff picked a place, a write failure must reach them, not fall back to Downloads.
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return true;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
