// Byte-level reader behind the repo-config guard `photo-location-free.test.js`:
// does a JPEG carry a location? It reads only the marker segments before the
// image data and returns whether a GPS block exists, never any value from it.
// Dependency-free on purpose: the guard must not depend on an Exif library's
// idea of what to parse. See jpeg-location.js.md.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP1 = 0xe1;
/** The Exif tag whose value points at the GPS IFD. */
export const GPS_IFD_POINTER = 0x8825;

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
/** Property names an XMP packet carries a location under (exif namespace). */
const XMP_GPS = /GPS(Latitude|Longitude)/;

/**
 * @typedef {{ readable: true, exifGps: boolean, xmpGps: boolean }
 *   | { readable: false, reason: string }} JpegLocation
 */

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {readonly number[]} id
 */
function startsWith(bytes, at, id) {
  if (at + id.length > bytes.length) return false;
  return id.every((b, i) => bytes[at + i] === b);
}

/**
 * Whether the Exif payload's first IFD holds the GPS IFD pointer.
 * @param {Uint8Array} bytes
 * @param {number} start - first byte of the TIFF header
 * @param {number} end - one past the segment's last byte
 * @returns {boolean | string} the answer, or why it could not be read
 */
function exifHasGps(bytes, start, end) {
  if (start + 8 > end) return 'the Exif header is cut short';
  const order = String.fromCharCode(bytes[start], bytes[start + 1]);
  if (order !== 'II' && order !== 'MM') return 'the Exif byte order is unknown';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = order === 'II';
  if (view.getUint16(start + 2, little) !== 42) return 'the Exif header is not TIFF';
  const ifd = start + view.getUint32(start + 4, little);
  if (ifd + 2 > end) return 'the first Exif directory lies outside its segment';
  const count = view.getUint16(ifd, little);
  if (ifd + 2 + count * 12 > end) return 'the first Exif directory runs past its segment';
  for (let i = 0; i < count; i += 1) {
    if (view.getUint16(ifd + 2 + i * 12, little) === GPS_IFD_POINTER) return true;
  }
  return false;
}

/**
 * Reads a JPEG's metadata segments for a location. Never throws on any input.
 * @param {Uint8Array} bytes
 * @returns {JpegLocation}
 */
export function jpegLocation(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    return { readable: false, reason: 'not a JPEG (no start marker)' };
  }
  let exifGps = false;
  let xmpGps = false;
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return { readable: false, reason: 'a segment does not start with a marker' };
    while (at < bytes.length && bytes[at] === 0xff) at += 1; // fill bytes
    if (at >= bytes.length) break;
    const marker = bytes[at];
    at += 1;
    // The metadata precedes the image data: nothing after it is read.
    if (marker === SOS || marker === EOI) return { readable: true, exifGps, xmpGps };
    // Markers that carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) return { readable: false, reason: 'a segment length is cut short' };
    const length = (bytes[at] << 8) | bytes[at + 1];
    const end = at + length;
    if (length < 2 || end > bytes.length) {
      return { readable: false, reason: 'a segment runs past the end of the file' };
    }
    const body = at + 2;
    if (marker === APP1 && startsWith(bytes, body, EXIF_ID)) {
      const found = exifHasGps(bytes, body + EXIF_ID.length, end);
      if (typeof found === 'string') return { readable: false, reason: found };
      exifGps ||= found;
    } else if (
      marker === APP1 &&
      startsWith(bytes, body, [...XMP_ID].map((c) => c.charCodeAt(0)))
    ) {
      const packet = new TextDecoder('latin1').decode(bytes.subarray(body + XMP_ID.length, end));
      xmpGps ||= XMP_GPS.test(packet);
    }
    at = end;
  }
  return { readable: false, reason: 'the file ends before its image data' };
}
