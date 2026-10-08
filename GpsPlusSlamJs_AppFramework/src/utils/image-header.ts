/**
 * An image's type and pixel size from its header alone, before any decode:
 * JPEG, PNG, WebP, GIF and AVIF - every raster type a tour may carry
 * (`ar/tour-media.ts`). A page that decodes an image it has not measured
 * can be made to allocate gigabytes by a few kilobytes of crafted file (a
 * "decode bomb"), so the tour kit checks this size against a pixel cap
 * before a picture, a figure or a model's texture is ever decoded (tour kit
 * K4 review R2).
 *
 * The JPEG, PNG and WebP readers follow the Globe's fetch-script reader
 * (`GpsPlusSlamJs_Globe/src/image-header.ts`, which also reads a WebP's
 * alpha); GIF and AVIF are added here. Pure: no I/O, never throws, never
 * reads past the buffer.
 *
 * @see image-header.ts.md
 */

export interface ImageHeaderInfo {
  readonly type: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A big-endian 16-bit value; bytes past the end read as 0. */
const u16 = (bytes: Uint8Array, i: number): number =>
  ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);

/** A big-endian 32-bit value; bytes past the end read as 0. */
const u32 = (bytes: Uint8Array, i: number): number =>
  ((bytes[i] ?? 0) * 0x1000000 +
    (((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0))) >>>
  0;

/** A little-endian 16-bit value. */
const u16le = (bytes: Uint8Array, i: number): number =>
  (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);

/** A little-endian 24-bit value. */
const u24le = (bytes: Uint8Array, i: number): number =>
  (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16);

const ascii = (bytes: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...bytes.subarray(i, i + n));

const sized = (
  type: ImageHeaderInfo['type'],
  width: number,
  height: number
): ImageHeaderInfo | null =>
  Number.isSafeInteger(width) &&
  Number.isSafeInteger(height) &&
  width > 0 &&
  height > 0
    ? { type, width, height }
    : null;

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

/** SOI and RST0-7 stand alone: they carry no length. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

/** The first frame segment's size: walks the segments from SOI. */
function jpegInfo(bytes: Uint8Array): ImageHeaderInfo | null {
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
    if (isFrameMarker(marker)) {
      if (i + 9 > bytes.length) return null;
      return sized('jpeg', u16(bytes, i + 7), u16(bytes, i + 5));
    }
    i += 2 + length;
  }
  return null;
}

/** The signature, then IHDR's big-endian width and height. */
function pngInfo(bytes: Uint8Array): ImageHeaderInfo | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((b, k) => bytes[k] === b)) return null;
  return sized('png', u32(bytes, 16), u32(bytes, 20));
}

/** A little-endian 32-bit value. */
const u32le = (bytes: Uint8Array, i: number): number =>
  ((bytes[i] ?? 0) |
    ((bytes[i + 1] ?? 0) << 8) |
    ((bytes[i + 2] ?? 0) << 16) |
    ((bytes[i + 3] ?? 0) << 24)) >>>
  0;

/** A WebP's first chunk's reader, by its four-character code: VP8X
 *  (24-bit width - 1, height - 1), VP8L (14-bit width - 1, height - 1 after
 *  the 0x2f signature) or VP8 (the frame's start code, then 14-bit width
 *  and height). */
const WEBP_CHUNKS: Readonly<
  Record<string, (b: Uint8Array) => readonly [number, number] | null>
> = {
  VP8X: (b) => [u24le(b, 24) + 1, u24le(b, 27) + 1],
  VP8L: (b) => {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  },
  'VP8 ': (b) =>
    b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a
      ? [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff]
      : null,
};

function webpInfo(bytes: Uint8Array): ImageHeaderInfo | null {
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  const size = Object.hasOwn(WEBP_CHUNKS, chunk)
    ? WEBP_CHUNKS[chunk]!(bytes)
    : null;
  return size === null ? null : sized('webp', size[0], size[1]);
}

/** The logical screen. A frame larger than it is clipped by the browsers'
 *  decoders, so the screen bounds what a decode allocates. */
function gifInfo(bytes: Uint8Array): ImageHeaderInfo | null {
  if (bytes.length < 10) return null;
  const magic = ascii(bytes, 0, 6);
  if (magic !== 'GIF87a' && magic !== 'GIF89a') return null;
  return sized('gif', u16le(bytes, 6), u16le(bytes, 8));
}

/** One ISO-BMFF box: its type, and where its body starts and ends. */
interface Box {
  readonly type: string;
  readonly body: number;
  readonly end: number;
}

/** The boxes between `from` and `to`. A box that claims to run past `to`
 *  is cut at `to` (a header read from the first bytes of a file). */
function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let i = from;
  while (i + 8 <= to && out.length < 256) {
    let size = u32(bytes, i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > to) break;
      size = u32(bytes, i + 8) * 0x100000000 + u32(bytes, i + 12);
      header = 16;
    } else if (size === 0) {
      size = to - i;
    }
    if (size < header) break;
    out.push({
      type: ascii(bytes, i + 4, 4),
      body: i + header,
      end: Math.min(i + size, to),
    });
    i += size;
  }
  return out;
}

const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Whether the `ftyp` box names an AVIF brand (major or compatible). */
function hasAvifBrand(bytes: Uint8Array, ftyp: Box): boolean {
  if (ftyp.end - ftyp.body < 8) return false;
  if (AVIF_BRANDS.has(ascii(bytes, ftyp.body, 4))) return true;
  for (let k = ftyp.body + 8; k + 4 <= ftyp.end; k += 4) {
    if (AVIF_BRANDS.has(ascii(bytes, k, 4))) return true;
  }
  return false;
}

/** The first child box of `type` in `parent`, after `skip` bytes (a
 *  FullBox's version and flags). */
function childBox(
  bytes: Uint8Array,
  parent: Box | undefined,
  type: string,
  skip = 0
): Box | undefined {
  return parent === undefined
    ? undefined
    : boxesIn(bytes, parent.body + skip, parent.end).find(
        (b) => b.type === type
      );
}

/** The largest `ispe` size in `ipco` (a grid's own size is the largest;
 *  its tiles are smaller). `ispe` is a FullBox: version and flags, then
 *  width and height. */
function largestIspe(bytes: Uint8Array, ipco: Box): ImageHeaderInfo | null {
  let best: ImageHeaderInfo | null = null;
  for (const box of boxesIn(bytes, ipco.body, ipco.end)) {
    if (box.type !== 'ispe' || box.body + 12 > box.end) continue;
    const info = sized(
      'avif',
      u32(bytes, box.body + 4),
      u32(bytes, box.body + 8)
    );
    const area = (i: ImageHeaderInfo | null) =>
      i === null ? 0 : i.width * i.height;
    if (area(info) > area(best)) best = info;
  }
  return best;
}

/** An ISO-BMFF file whose `ftyp` names an AVIF brand: the largest item
 *  size in `meta` > `iprp` > `ipco` > `ispe`. */
function avifInfo(bytes: Uint8Array): ImageHeaderInfo | null {
  const top = boxesIn(bytes, 0, bytes.length);
  const ftyp = top[0];
  if (ftyp?.type !== 'ftyp' || !hasAvifBrand(bytes, ftyp)) return null;
  // `meta` is a FullBox: 4 bytes of version and flags before its children.
  const meta = top.find((b) => b.type === 'meta');
  const ipco = childBox(bytes, childBox(bytes, meta, 'iprp', 4), 'ipco');
  return ipco === undefined ? null : largestIspe(bytes, ipco);
}

/** Each header reader, with the magic bytes that pick it. */
const READERS: readonly {
  readonly sniff: (b: Uint8Array) => boolean;
  readonly read: (b: Uint8Array) => ImageHeaderInfo | null;
}[] = [
  { sniff: (b) => b[0] === 0xff && b[1] === 0xd8, read: jpegInfo },
  { sniff: (b) => b[0] === 0x89, read: pngInfo },
  { sniff: (b) => ascii(b, 0, 4) === 'RIFF', read: webpInfo },
  { sniff: (b) => ascii(b, 0, 3) === 'GIF', read: gifInfo },
  { sniff: (b) => b.length >= 12 && ascii(b, 4, 4) === 'ftyp', read: avifInfo },
];

/** The image's type and size, or null when the bytes are not a complete
 *  header of a JPEG, PNG, WebP, GIF or AVIF. */
export function imageInfo(bytes: Uint8Array): ImageHeaderInfo | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  return READERS.find((r) => r.sniff(bytes))?.read(bytes) ?? null;
}

/**
 * How much of a Blob the header is read from: 1 MiB, well past the EXIF,
 * ICC and XMP segments a camera writes before a JPEG's frame (each at most
 * 64 KiB). A header further in reads as unknown, never as a guess.
 */
const IMAGE_HEADER_PROBE_BYTES = 1024 * 1024;

/** `imageInfo` of a Blob's first `probeBytes`; null when they hold no
 *  complete header, or the Blob cannot be read. */
export async function imageInfoOfBlob(
  blob: Blob,
  probeBytes: number = IMAGE_HEADER_PROBE_BYTES
): Promise<ImageHeaderInfo | null> {
  try {
    const head = await blob.slice(0, probeBytes).arrayBuffer();
    return imageInfo(new Uint8Array(head));
  } catch {
    return null;
  }
}
