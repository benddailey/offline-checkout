/** A macOS .icns holding PNG images, keyed by the OSType for each pixel size. */
const TYPES: Record<number, string[]> = {
  16: ["icp4"],
  32: ["icp5", "ic11"],
  64: ["icp6", "ic12"],
  128: ["ic07"],
  256: ["ic08", "ic13"],
  512: ["ic09", "ic14"],
  1024: ["ic10"],
};

export const ICNS_SIZES = Object.keys(TYPES).map(Number);

export function buildIcns(images: { size: number; png: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const { size, png } of images) {
    const types = TYPES[size];
    if (!types) throw new Error(`.icns has no PNG slot for ${size}px`);
    for (const type of types) {
      const header = Buffer.alloc(8);
      header.write(type, 0, "ascii");
      header.writeUInt32BE(8 + png.length, 4);
      chunks.push(header, png);
    }
  }
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  const body = Buffer.concat(chunks);
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}
