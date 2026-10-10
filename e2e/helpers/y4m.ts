import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 30;
const QUIET_MODULES = 4;

/** Write a YUV4MPEG2 (C420jpeg) clip of a QR code for Chrome's fake video capture. */
export function writeQrY4m(text: string, path: string): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const scale = Math.floor(Math.min(WIDTH, HEIGHT) / (n + 2 * QUIET_MODULES));
  const side = n * scale;
  const x0 = Math.floor((WIDTH - side) / 2);
  const y0 = Math.floor((HEIGHT - side) / 2);

  const y = Buffer.alloc(WIDTH * HEIGHT, 255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        y.fill(
          0,
          (y0 + r * scale + dy) * WIDTH + x0 + c * scale,
          (y0 + r * scale + dy) * WIDTH + x0 + (c + 1) * scale,
        );
      }
    }
  }
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(path, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]));
}
