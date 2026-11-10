/**
 * PNG chunk reading and writing, enough to carry a character record inside
 * its picture: read the chunk list and header, find or add a `tEXt` chunk.
 * No pixel decoding; the browser decodes the picture.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/** A file that claims to be a PNG but is cut off or has a bad chunk. */
export class PngDamaged extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngDamaged";
  }
}

export interface PngChunk {
  readonly type: string;
  /** Offset of the chunk's length field in the file. */
  readonly start: number;
  readonly data: Uint8Array;
}

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** The standard CRC-32 (the one PNG chunks carry). */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= SIGNATURE.length &&
    SIGNATURE.every((b, i) => bytes[i] === b)
  );
}

export function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

/**
 * The chunks of a PNG, up to and including IEND. Throws `PngDamaged` when
 * the signature is missing, a chunk runs past the end, a checksum does not
 * match, or the file ends before IEND.
 */
export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new PngDamaged("not a PNG signature");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let at: number = SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const len = dv.getUint32(at);
    const end = at + 12 + len;
    if (end > bytes.length) {
      throw new PngDamaged("a chunk runs past the end of the file");
    }
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const crc = crc32(bytes.subarray(at + 4, at + 8 + len));
    if (dv.getUint32(at + 8 + len) !== crc) {
      throw new PngDamaged(`the ${type} chunk's checksum does not match`);
    }
    chunks.push({
      type,
      start: at,
      data: bytes.subarray(at + 8, at + 8 + len),
    });
    at = end;
    if (type === "IEND") return chunks;
  }
  throw new PngDamaged("the file ends before its last chunk");
}

/** Size and alpha from IHDR (colour type 4 or 6, or any tRNS chunk). */
export function pngHeader(chunks: readonly PngChunk[]): PngHeader | null {
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return null;
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const colorType = ihdr.data[9]!;
  return {
    width: dv.getUint32(0),
    height: dv.getUint32(4),
    hasAlpha:
      colorType === 4 ||
      colorType === 6 ||
      chunks.some((c) => c.type === "tRNS"),
  };
}

/** The text of the first `tEXt` chunk with this key, or null. */
export function readTextChunk(
  chunks: readonly PngChunk[],
  key: string,
): string | null {
  for (const c of chunks) {
    if (c.type !== "tEXt") continue;
    const nul = c.data.indexOf(0);
    if (nul < 0 || latin1(c.data.subarray(0, nul)) !== key) continue;
    return latin1(c.data.subarray(nul + 1));
  }
  return null;
}

const PRINTABLE = /^[\x20-\x7e]*$/;

function textChunk(key: string, text: string): Uint8Array {
  const len = key.length + 1 + text.length;
  const out = new Uint8Array(12 + len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  out.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  for (let i = 0; i < key.length; i++) out[8 + i] = key.charCodeAt(i);
  for (let i = 0; i < text.length; i++) {
    out[9 + key.length + i] = text.charCodeAt(i);
  }
  dv.setUint32(8 + len, crc32(out.subarray(4, 8 + len)));
  return out;
}

/**
 * A copy of the PNG with a `tEXt` chunk (key, text) just before IEND; an
 * earlier `tEXt` chunk with the same key is dropped. Key and text must be
 * printable ASCII (use `asciiJson`), the key 1 to 79 letters.
 */
export function withTextChunk(
  bytes: Uint8Array,
  key: string,
  text: string,
): Uint8Array {
  if (key.length < 1 || key.length > 79 || !PRINTABLE.test(key)) {
    throw new RangeError("a PNG text key is 1 to 79 printable ASCII letters");
  }
  if (!PRINTABLE.test(text)) {
    throw new RangeError("PNG text must be printable ASCII");
  }
  const parts: Uint8Array[] = [Uint8Array.from(SIGNATURE)];
  for (const c of readChunks(bytes)) {
    if (c.type === "tEXt" && readTextChunk([c], key) !== null) continue;
    if (c.type === "IEND") parts.push(textChunk(key, text));
    parts.push(bytes.subarray(c.start, c.start + 12 + c.data.length));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** JSON with every non-ASCII letter escaped, so it fits a `tEXt` chunk. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
