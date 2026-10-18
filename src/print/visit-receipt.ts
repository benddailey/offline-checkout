import { receiptLines, type VisitReceipt } from "./receipt";

/** One line per receipt line, set with textContent only: session and clerk names come from peers. */
export function renderVisitReceipt(r: VisitReceipt): HTMLElement {
  const lines = receiptLines(r);
  const patronAt = 4;
  const ruleAt = new Set([lines.length - 1, ...(r.items.length ? [patronAt + 1] : [])]);
  const box = document.createElement("div");
  lines.forEach((text, i) => {
    const line = document.createElement("div");
    line.textContent = text;
    if (i === 0) Object.assign(line.style, { fontSize: "14pt", fontWeight: "bold" });
    if (i === patronAt) line.style.fontWeight = "bold";
    if (ruleAt.has(i)) {
      Object.assign(line.style, {
        borderTop: "1px solid #000",
        marginTop: "1mm",
        paddingTop: "1mm",
      });
    }
    box.append(line);
  });
  return box;
}
