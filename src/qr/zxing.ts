import { setZXingModuleOverrides } from "vue-qrcode-reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

/** Decode a `data:...;base64,` URL into bytes without any network access. */
function dataUrlToBytes(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Hand the inlined reader binary to zxing so it never fetches one from a CDN.
// Dev serves the wasm as a local file URL rather than inlining it.
setZXingModuleOverrides(
  wasmUrl.startsWith("data:")
    ? {
        wasmBinary: dataUrlToBytes(wasmUrl).buffer as ArrayBuffer,
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? "data:," : prefix + path,
      }
    : {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? wasmUrl : prefix + path,
      },
);
