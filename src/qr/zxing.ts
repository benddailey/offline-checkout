import { setZXingModuleOverrides } from "vue-qrcode-reader";
// Must be the zxing-wasm copy that barcode-detector (inside vue-qrcode-reader) pins: the wasm
// import table is tied to that glue code, so the top-level zxing-wasm 3.x binary does not link.
import wasmDataUrl from "../../node_modules/barcode-detector/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url";

/** Decode a `data:...;base64,` URL into bytes without any network access. */
function dataUrlToBytes(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Hand the inlined reader binary to zxing so it never fetches one from a CDN.
setZXingModuleOverrides({
  wasmBinary: dataUrlToBytes(wasmDataUrl).buffer as ArrayBuffer,
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "data:," : prefix + path),
});
