import { deflateSync } from 'node:zlib';

function uint32be(n: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  return Buffer.concat([
    uint32be(data.length),
    typeBytes,
    data,
    uint32be(crc32(crcInput)),
  ]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Encodes raw pixel data (as returned by unpdf.extractImages) to a valid PNG
 * buffer using only Node.js built-in `zlib`. No native add-ons required.
 *
 * Supports 1 (grayscale), 3 (RGB), and 4 (RGBA) channel images.
 */
export function rawPixelsToPng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): Buffer {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      `rawPixelsToPng: invalid image dimensions ${width}x${height}`,
    );
  }
  const expectedLength = width * height * channels;
  if (pixels.length !== expectedLength) {
    throw new Error(
      `rawPixelsToPng: pixel buffer length ${pixels.length} does not match ${width}x${height}x${channels} (expected ${expectedLength})`,
    );
  }

  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdrData = Buffer.concat([
    uint32be(width),
    uint32be(height),
    Buffer.from([8, colorType, 0, 0, 0]),
  ]);

  const stride = width * channels;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0; // filter type: None
    const srcOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      raw[rowOffset + 1 + x] = pixels[srcOffset + x];
    }
  }

  const compressed = deflateSync(raw, { level: 1 });

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
