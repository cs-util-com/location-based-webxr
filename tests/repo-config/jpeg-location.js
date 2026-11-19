// Byte-level reader behind the repo-config guard `photo-location-free.test.js`:
// does a JPEG carry a location? It reads the marker segments, skips the image
// data, and returns whether a GPS block exists, never any value from it.
// Dependency-free on purpose: the guard must not depend on an Exif library's
// idea of what to parse. See jpeg-location.js.md.

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP15 = 0xef;
/** The Exif tag whose value points at the GPS IFD. */
export const GPS_IFD_POINTER = 0x8825;

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
/** What an APP1 segment of either known kind begins with: one that begins so
 *  but matches no identifier below is a variant this reader does not know. */
const EXIF_PREFIX = 'Exif';
const ADOBE_PREFIX = 'http://ns.adobe.com/';
/** The Multi-Picture Format (APP2): further images follow the first. */
const MPF_ID = 'MPF\0';
const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
/** The continuation of an XMP packet too large for one segment (XMP part 3). */
const EXTENDED_XMP_ID = 'http://ns.adobe.com/xmp/extension/\0';
/** The standard packet's note that the packet continues in ExtendedXMP. */
const XMP_HAS_EXTENDED = /HasExtendedXMP/;
/** Property names a location is carried under (the exif namespace's, and
 *  their destination variants), in any case. Searched in every APPn body, so
 *  an XMP packet in Photoshop's APP13 is found as one in APP1 is. */
const XMP_GPS = /GPS(Dest)?(Latitude|Longitude)/i;

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

/** @param {string} text */
const codes = (text) => [...text].map((c) => c.charCodeAt(0));

/**
 * The offset of the marker that ends the entropy-coded data starting at
 * `at`: the first 0xFF followed by neither a stuffed zero, a restart marker
 * nor another fill byte; `bytes.length` when none does.
 * @param {Uint8Array} bytes
 * @param {number} at
 */
function scanEnd(bytes, at) {
  for (let i = at; i + 1 < bytes.length; i += 1) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1];
    if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) continue;
    return i;
  }
  return bytes.length;
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
  let scanned = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return { readable: false, reason: 'a segment does not start with a marker' };
    while (at < bytes.length && bytes[at] === 0xff) at += 1; // fill bytes
    if (at >= bytes.length) break;
    const marker = bytes[at];
    at += 1;
    if (marker === EOI) {
      if (!scanned) break;
      // A secondary image or a motion-photo video can follow the first
      // image, with metadata of its own: not read, so not clean.
      if (at < bytes.length) return { readable: false, reason: 'bytes follow the end of the image' };
      return { readable: true, exifGps, xmpGps };
    }
    // Markers that carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) return { readable: false, reason: 'a segment length is cut short' };
    const length = (bytes[at] << 8) | bytes[at + 1];
    const end = at + length;
    if (length < 2 || end > bytes.length) {
      return { readable: false, reason: 'a segment runs past the end of the file' };
    }
    const body = at + 2;
    if (marker === SOS) {
      // The image data is skipped, not parsed. A progressive image has
      // several scans, with segments (metadata too) between them.
      scanned = true;
      at = scanEnd(bytes, end);
      continue;
    }
    if (marker >= APP0 && marker <= APP15) {
      xmpGps ||= XMP_GPS.test(new TextDecoder('latin1').decode(bytes.subarray(body, end)));
    }
    if (marker === APP2 && startsWith(bytes, body, codes(MPF_ID))) {
      return { readable: false, reason: 'a Multi-Picture segment names further images' };
    }
    if (marker === APP1 && startsWith(bytes, body, EXIF_ID)) {
      const found = exifHasGps(bytes, body + EXIF_ID.length, end);
      if (typeof found === 'string') return { readable: false, reason: found };
      exifGps ||= found;
    } else if (
      marker === APP1 &&
      startsWith(bytes, body, codes(XMP_ID))
    ) {
      const packet = new TextDecoder('latin1').decode(bytes.subarray(body + XMP_ID.length, end));
      // A NUL byte means UTF-16 or UTF-32, where a byte search for the
      // property names finds nothing: unread, so not clean.
      if (packet.includes('\0')) return { readable: false, reason: 'the XMP packet is not UTF-8' };
      if (XMP_HAS_EXTENDED.test(packet)) {
        return { readable: false, reason: 'the XMP packet continues in ExtendedXMP' };
      }
      xmpGps ||= XMP_GPS.test(packet);
    } else if (
      marker === APP1 &&
      startsWith(bytes, body, codes(EXTENDED_XMP_ID))
    ) {
      // Split across segments, possibly out of order: not joined here.
      return { readable: false, reason: 'an ExtendedXMP segment is not read' };
    } else if (
      marker === APP1 &&
      (startsWith(bytes, body, codes(EXIF_PREFIX)) || startsWith(bytes, body, codes(ADOBE_PREFIX)))
    ) {
      return { readable: false, reason: 'an APP1 segment of an unknown Exif or Adobe kind' };
    }
    at = end;
  }
  return { readable: false, reason: 'the file ends before its image data' };
}
