export const PRINT_ROOT_ID = "oc-print-root";
export const PRINT_STYLE_ID = "oc-print-style";
export const RECEIPT_WIDTH_MM = 72;

const BASE_CSS = `
#${PRINT_ROOT_ID} {
  position: fixed; left: -10000px; top: 0; width: ${RECEIPT_WIDTH_MM}mm; visibility: hidden;
  box-sizing: border-box; padding: 2mm 3mm; margin: 0;
  color: #000; background: #fff; font: 11pt/1.3 Arial, sans-serif; overflow-wrap: anywhere;
}
/* No page size: Chrome centres a CSS-sized page on the printer's 3 m "72mm x Receipt" paper,
   and the roll feeds to it. Unsized, the receipt starts at the top and the driver cuts after it. */
@page { margin: 0 }
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

/** Show `content` as the only printed thing, 72 mm wide at the top of the page, then window.print(). */
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
