import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readBarcodesFromImageFile, setZXingModuleOverrides } from "zxing-wasm/reader";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** All text of the PDF, page by page, text items joined with spaces. */
export async function pdfText(path: string): Promise<string> {
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({ data, useSystemFonts: true });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

let wasmReady = false;

/** Load the zxing reader from node_modules; it would otherwise fetch the wasm from a CDN. */
export async function useLocalWasm(): Promise<void> {
  if (wasmReady) return;
  const wasm = await readFile(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  setZXingModuleOverrides({
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  });
  wasmReady = true;
}

/** Every Code 128 barcode on every page, rasterised at 300 dpi with pdftoppm. */
export async function decodePdfBarcodes(path: string): Promise<string[]> {
  await useLocalWasm();
  const dir = await mkdtemp(join(tmpdir(), "oc-pdf-"));
  try {
    await run("pdftoppm", ["-r", "300", "-png", path, join(dir, "page")]);
    const pngs = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const found: string[] = [];
    for (const png of pngs) {
      const blob = new Blob([await readFile(join(dir, png))], { type: "image/png" });
      const results = await readBarcodesFromImageFile(blob, {
        formats: ["Code128"],
        maxNumberOfSymbols: 255,
        tryHarder: true,
      });
      for (const r of results) if (r.isValid) found.push(r.text);
    }
    return found;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
