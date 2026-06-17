import { rawPixelsToPng } from './png-encoder';

describe('rawPixelsToPng', () => {
  it('encodes a valid RGBA buffer to a PNG with the right magic bytes', () => {
    // 2x2 RGBA = 16 bytes
    const pixels = new Uint8ClampedArray(2 * 2 * 4).fill(255);

    const png = rawPixelsToPng(pixels, 2, 2, 4);

    expect(png).toBeInstanceOf(Buffer);
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('throws a contextual error when the buffer length does not match the dimensions', () => {
    // claims 4x4x4 = 64 bytes but only provides 16
    const pixels = new Uint8ClampedArray(16);

    expect(() => rawPixelsToPng(pixels, 4, 4, 4)).toThrow(
      /pixel buffer length 16 does not match 4x4x4/,
    );
  });

  it.each([
    ['zero width', 0, 2],
    ['zero height', 2, 0],
    ['non-integer width', 2.5, 2],
    ['negative width', -1, 2],
  ])('throws on %s', (_label, width, height) => {
    const pixels = new Uint8ClampedArray(0);

    expect(() => rawPixelsToPng(pixels, width, height, 4)).toThrow(
      /invalid image dimensions/,
    );
  });

  it('encodes a valid grayscale (1-channel) buffer', () => {
    // 2x2 grayscale = 4 bytes
    const pixels = new Uint8ClampedArray([0, 64, 128, 255]);

    const png = rawPixelsToPng(pixels, 2, 2, 1);

    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('encodes a valid RGB (3-channel) buffer', () => {
    // 2x2 RGB = 12 bytes
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0,
    ]);

    const png = rawPixelsToPng(pixels, 2, 2, 3);

    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
