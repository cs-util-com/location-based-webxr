/**
 * The type and size of a JPEG, PNG or WebP from its header alone (globe
 * plan 2026-09-26-0539 §7.4): the fetch script checks every downloaded and
 * every written image without decoding it. For a WebP it also reads
 * whether the image has alpha, which carries the imagery tiles' water mask
 * (round-4 plan 2026-09-28-2105 DEC-GL4-6).
 *
 * @see image-header.ts.md
 */

export type ImageInfo =
  | {
      readonly type: "jpeg" | "png";
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: "webp";
      readonly width: number;
      readonly height: number;
      /** Whether the header says the image carries alpha. */
      readonly alpha: boolean;
    };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** SOF0-SOF15 frame markers, minus DHT (C4), JPG (C8) and DAC (CC). */
function isFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/** A big-endian 16-bit value; bytes past the end read as 0. */
const u16 = (bytes: Uint8Array, i: number): number =>
  ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);

/** SOI and RST0-7 stand alone: they carry no length. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

/** The size in the frame segment starting at `i`, or null if truncated. */
function frameSize(bytes: Uint8Array, i: number): ImageInfo | null {
  if (i + 9 > bytes.length) return null;
  const height = u16(bytes, i + 5);
  const width = u16(bytes, i + 7);
  return width > 0 && height > 0 ? { type: "jpeg", width, height } : null;
}

function jpegInfo(bytes: Uint8Array): ImageInfo | null {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    if (isStandaloneMarker(marker)) {
      i += 2;
      continue;
    }
    const length = u16(bytes, i + 2);
    if (length < 2) return null;
    if (isFrameMarker(marker)) return frameSize(bytes, i);
    i += 2 + length;
  }
  return null;
}

function pngInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((b, k) => bytes[k] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { type: "png", width, height } : null;
}

const ascii = (bytes: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...bytes.subarray(i, i + n));

/** A little-endian 24-bit value. */
const u24le = (bytes: Uint8Array, i: number): number =>
  (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16);

type WebpSize = { width: number; height: number; alpha: boolean };

/** The first chunk's reader, by its four-character code (see webpInfo). */
const WEBP_CHUNKS: Record<
  string,
  (b: Uint8Array, v: DataView) => WebpSize | null
> = {
  VP8X: (b) => ({
    width: u24le(b, 24) + 1,
    height: u24le(b, 27) + 1,
    alpha: ((b[20] ?? 0) & 0x10) !== 0,
  }),
  VP8L: (b, v) => {
    if (b[20] !== 0x2f) return null;
    const bits = v.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    };
  },
  "VP8 ": (b, v) =>
    b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a
      ? {
          width: v.getUint16(26, true) & 0x3fff,
          height: v.getUint16(28, true) & 0x3fff,
          alpha: false,
        }
      : null,
};

/**
 * A WebP's size and alpha from its first chunk: VP8X (the extended
 * format, which a lossy image with alpha uses: flags, then 24-bit width - 1
 * and height - 1), VP8L (lossless: a 0x2f signature, then 14-bit width - 1,
 * height - 1 and an alpha bit) or VP8 (simple lossy, never alpha: the
 * frame's start code, then 14-bit width and height).
 */
function webpInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== "WEBP") return null;
  const read = WEBP_CHUNKS[ascii(bytes, 12, 4)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = read ? read(bytes, view) : null;
  return size && size.width > 0 && size.height > 0
    ? { type: "webp", ...size }
    : null;
}

/** The image's type and size, or null when the bytes are not one. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  if (bytes[0] === 0x89) return pngInfo(bytes);
  if (ascii(bytes, 0, 4) === "RIFF") return webpInfo(bytes);
  return null;
}
