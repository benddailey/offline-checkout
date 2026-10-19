export const PRINT_ROOT_ID = "oc-print-root";
export const PRINT_STYLE_ID = "oc-print-style";
export const RECEIPT_WIDTH_MM = 72;

const PX_TO_MM = 25.4 / 96;
/** Extra paper below the content so the cutter does not clip the last line. */
const FEED_MM = 4;

/** Taller than wide: Chrome prints a page wider than tall landscape, and roll drivers then feed blank paper. */
export function pageHeightMm(contentPx: number): number {
  return Math.max(Math.ceil(contentPx * PX_TO_MM) + FEED_MM, RECEIPT_WIDTH_MM + 1);
}

const BASE_CSS = `
#${PRINT_ROOT_ID} {
  position: fixed; left: -10000px; top: 0; width: ${RECEIPT_WIDTH_MM}mm; visibility: hidden;
  box-sizing: border-box; padding: 2mm 3mm; margin: 0;
  color: #000; background: #fff; font: 11pt/1.3 Arial, sans-serif; overflow-wrap: anywhere;
}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
  #${PRINT_ROOT_ID} { position: static; visibility: visible; width: ${RECEIPT_WIDTH_MM}mm; }
}
`;

function removePrinted(): void {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

/** Show `content` as the only printed thing, sized 72 mm wide and exactly as tall as it is, then window.print(). */
export function printElement(content: HTMLElement, extraCss = ""): void {
  removePrinted();
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.append(content);
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = BASE_CSS + extraCss;
  document.head.append(style);
  document.body.append(root);

  // Chrome ignores `size: 72mm auto`, so the page is sized to the measured receipt.
  const heightMm = pageHeightMm(root.getBoundingClientRect().height);
  style.textContent += `@page { size: ${RECEIPT_WIDTH_MM}mm ${heightMm}mm; margin: 0 }\n`;

  window.addEventListener("afterprint", removePrinted, { once: true });
  try {
    window.print();
  } catch (err) {
    window.removeEventListener("afterprint", removePrinted);
    removePrinted();
    throw err;
  }
}

/** Resolves once the current DOM has been painted (rAF, then a task); a timer covers hidden tabs, where rAF never fires. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
}
