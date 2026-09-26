/**
 * The type and size of a JPEG or PNG from its header alone (globe plan
 * 2026-09-26-0539 §7.4): the fetch script checks every downloaded image
 * without an image decoder, so no dependency is added for it.
 *
 * @see image-header.ts.md
 */

export interface ImageInfo {
  readonly type: "jpeg" | "png";
  readonly width: number;
  readonly height: number;
}

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

/** The image's type and size, or null when the bytes are not one. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegInfo(bytes);
  if (bytes[0] === 0x89) return pngInfo(bytes);
  return null;
}
