// Why these tests matter: the photo-location guard is only as good as this
// reader. A reader that missed the GPS pointer (in either byte order, behind
// another segment, among other tags) would let a photo's location into the
// public repository silently, and one that threw or answered "clean" on a
// damaged file would hide exactly the file nobody checked. All inputs are
// tiny synthetic JPEGs built here; no real photo is read.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { GPS_IFD_POINTER, jpegLocation } from './jpeg-location.js';

const MAKE = 0x010f;
const ORIENTATION = 0x0112;

/** @param {number} marker @param {number[]} body */
function segment(marker, body) {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/** An Exif APP1 body whose first IFD holds `tags` (values zero). */
function exifBody(tags, little = true) {
  const u16 = (v) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v) => (little ? [v & 0xff, 0, 0, 0] : [0, 0, 0, v & 0xff]);
  const entries = tags.flatMap((tag) => [...u16(tag), ...u16(4), ...u32(1), ...u32(0)]);
  return [
    ...[0x45, 0x78, 0x69, 0x66, 0, 0],
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(tags.length),
    ...entries,
    ...u32(0),
  ];
}

/** @param {string} text */
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

/** A JPEG of the given segments, a scan header and the end marker. */
function jpeg(...segments) {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...segment(0xda, [0, 0]), 0xff, 0xd9]);
}

const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

describe('jpegLocation', () => {
  it('finds the GPS pointer in either byte order, behind other segments and tags', () => {
    for (const little of [true, false]) {
      const found = jpegLocation(jpeg(JFIF, segment(0xe1, exifBody([MAKE, GPS_IFD_POINTER], little))));
      expect(found, `little=${little}`).toEqual({ readable: true, exifGps: true, xmpGps: false });
    }
  });

  it('answers no for Exif without the GPS pointer, and for a JPEG with no Exif', () => {
    expect(jpegLocation(jpeg(segment(0xe1, exifBody([MAKE, ORIENTATION]))))).toEqual({
      readable: true,
      exifGps: false,
      xmpGps: false,
    });
    expect(jpegLocation(jpeg(JFIF))).toEqual({ readable: true, exifGps: false, xmpGps: false });
  });

  it('finds a location an XMP packet carries', () => {
    const xmp = segment(0xe1, [
      ...ascii('http://ns.adobe.com/xap/1.0/'),
      0,
      ...ascii('<x:xmpmeta><rdf:Description exif:GPSLatitude="0,0N"/></x:xmpmeta>'),
    ]);
    expect(jpegLocation(jpeg(xmp))).toEqual({ readable: true, exifGps: false, xmpGps: true });
  });

  it('never answers clean for a damaged file or one that is no JPEG', () => {
    const good = jpeg(segment(0xe1, exifBody([MAKE])));
    const directoryPastSegment = jpeg(segment(0xe1, exifBody([MAKE]).slice(0, 18)));
    for (const bytes of [
      Uint8Array.from([]),
      Uint8Array.from(ascii('not a jpeg')),
      good.subarray(0, 10),
      directoryPastSegment,
      Uint8Array.from([0xff, 0xd8, 0x00]),
    ]) {
      expect(jpegLocation(bytes).readable, String([...bytes.subarray(0, 12)])).toBe(false);
    }
  });

  // Why: the guard reads every tracked photo, so the reader must answer for
  // any IFD, and its GPS answer must follow the pointer exactly.
  it('finds the pointer exactly when the first IFD holds it (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 20 }),
        fc.boolean(),
        (tags, little) => {
          const found = jpegLocation(jpeg(segment(0xe1, exifBody(tags, little))));
          expect(found).toEqual({
            readable: true,
            exifGps: tags.includes(GPS_IFD_POINTER),
            xmpGps: false,
          });
        },
      ),
    );
  });

  it('never throws on any bytes, nor on any prefix of a valid file (property)', () => {
    const valid = jpeg(JFIF, segment(0xe1, exifBody([MAKE, GPS_IFD_POINTER])));
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(() => jpegLocation(Uint8Array.from([0xff, 0xd8, ...bytes]))).not.toThrow();
      }),
    );
    for (let cut = 0; cut < valid.length; cut += 1) {
      const result = jpegLocation(valid.subarray(0, cut));
      // A cut file never reads as a clean one: it is unreadable until the
      // scan header, and by then the GPS pointer has been read.
      if (result.readable) expect(result.exifGps).toBe(true);
    }
  });
});
