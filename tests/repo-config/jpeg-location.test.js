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

/** A Photoshop image resource: its signature ("8BIM" unless given), its id,
 *  an empty name, its size and its data, padded to an even length. */
function resource(id, data, signature = '8BIM') {
  const size = data.length;
  const pad = size % 2 === 1 ? [0] : [];
  return [
    ...ascii(signature),
    id >> 8,
    id & 0xff,
    0,
    0,
    (size >>> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...data,
    ...pad,
  ];
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

  // Why: a location can sit where this reader does not look. An XMP packet
  // over 64 KB continues in ExtendedXMP segments (split, possibly out of
  // order), and a UTF-16 packet hides the property names from a byte search.
  // Neither is read, so each must make the file unreadable: the guard fails
  // closed instead of answering clean.
  it('never answers clean for XMP it cannot fully read', () => {
    const XMP = ascii('http://ns.adobe.com/xap/1.0/');
    const EXTENDED = ascii('http://ns.adobe.com/xmp/extension/');
    const extended = segment(0xe1, [
      ...EXTENDED,
      0,
      ...ascii('0123456789ABCDEF0123456789ABCDEF'),
      ...[0, 0, 0, 64, 0, 0, 0, 0],
      ...ascii('<rdf:Description exif:GPSLatitude="0,0N"/>'),
    ]);
    const pointsToExtended = segment(0xe1, [
      ...XMP,
      0,
      ...ascii('<rdf:Description xmpNote:HasExtendedXMP="0123456789ABCDEF0123456789ABCDEF"/>'),
    ]);
    const utf16 = segment(0xe1, [
      ...XMP,
      0,
      ...ascii('<rdf:Description exif:GPSLatitude="0,0N"/>').flatMap((c) => [c, 0]),
    ]);
    for (const [name, bytes] of [
      ['an ExtendedXMP segment alone', jpeg(extended)],
      ['a standard packet pointing at ExtendedXMP', jpeg(pointsToExtended)],
      ['both', jpeg(pointsToExtended, extended)],
      ['a UTF-16 packet', jpeg(utf16)],
    ]) {
      expect(jpegLocation(bytes).readable, name).toBe(false);
    }
  });

  // Why: a location is written under other names and in other places than
  // the two the reader first knew. Destination coordinates and a lower-case
  // spelling are locations too, and Photoshop keeps its XMP copy in APP13,
  // not APP1, so the search runs over every APPn body.
  it('finds a location under its destination names, in any case, in any APPn segment', () => {
    const XMP = ascii('http://ns.adobe.com/xap/1.0/');
    for (const property of ['GPSDestLatitude', 'gpslongitude', 'GPSDestLongitude']) {
      const xmp = segment(0xe1, [...XMP, 0, ...ascii(`<rdf:Description exif:${property}="0,0N"/>`)]);
      expect(jpegLocation(jpeg(xmp)), property).toEqual({ readable: true, exifGps: false, xmpGps: true });
    }
    const photoshop = segment(0xed, [
      ...ascii('Photoshop 3.0'),
      0,
      ...resource(0x0424, ascii('<rdf:Description exif:GPSLatitude="0,0N"/>')),
    ]);
    expect(jpegLocation(jpeg(photoshop))).toEqual({ readable: true, exifGps: false, xmpGps: true });
  });

  // Why: metadata the reader does not read must never pass as clean. An
  // APP1 that begins like Exif or an Adobe packet but is neither known kind
  // is a variant nobody checked; a Multi-Picture segment and any bytes after
  // the first image's end marker hold further images (a phone's depth map, a
  // motion photo's video) with metadata of their own.
  it('never answers clean for metadata or images it does not read', () => {
    const afterEnd = Uint8Array.from([...jpeg(JFIF), ...ascii('ftypmp42')]);
    for (const [name, bytes] of [
      ['an Exif variant', jpeg(segment(0xe1, [...ascii('Exif'), 0xff, 0x49, 0x49, 42, 0]))],
      ['an unknown Adobe packet', jpeg(segment(0xe1, [...ascii('http://ns.adobe.com/other/'), 0, 1]))],
      ['a Multi-Picture segment', jpeg(segment(0xe2, [...ascii('MPF'), 0, 0x49, 0x49, 42, 0]))],
      ['bytes after the end marker', afterEnd],
      ['a second image after the first', Uint8Array.from([...jpeg(JFIF), ...jpeg(JFIF)])],
    ]) {
      expect(jpegLocation(bytes).readable, name).toBe(false);
    }
  });

  // Why: a location can be binary, in a segment kind no text search can
  // read: an action camera's telemetry (GoPro's GPMF in APP6), a thermal
  // camera's APP1 record (FLIR). So only a short allowlist of segment kinds
  // passes (JFIF and JFXX in APP0, Exif and XMP in APP1, an ICC profile in
  // APP2, Photoshop's APP13, Adobe's APP14), and every other APPn fails
  // closed. A second standard XMP packet or a Photoshop block split over two
  // segments fails too: a property name can be cut at the boundary.
  it('never answers clean for a segment kind outside its allowlist, nor a split packet', () => {
    const XMP = ascii('http://ns.adobe.com/xap/1.0/');
    const xmp = segment(0xe1, [...XMP, 0, ...ascii('<rdf:Description exif:GPSLat')]);
    const xmpRest = segment(0xe1, [...XMP, 0, ...ascii('itude="0,0N"/>')]);
    const photoshop = (text) =>
      segment(0xed, [...ascii('Photoshop 3.0'), 0, ...ascii('8BIM'), 4, 4, ...ascii(text)]);
    const photoshopWith = (...resources) => segment(0xed, [...ascii('Photoshop 3.0'), 0, ...resources.flat()]);
    const otherApps = [0xe3, 0xe4, 0xe5, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xef];
    for (const [name, bytes] of [
      ['GoPro telemetry in APP6', jpeg(segment(0xe6, [...ascii('GoPro'), 0, ...ascii('DEVC'), 0, 1]))],
      ['a FLIR record in APP1', jpeg(segment(0xe1, [...ascii('FLIR'), 0, 1, 0, 2, 3]))],
      ['an unknown APP0 kind', jpeg(segment(0xe0, [...ascii('AVI1'), 0, 0]))],
      ['an unknown APP2 kind', jpeg(segment(0xe2, [...ascii('FPXR'), 0, 0]))],
      ['an Adobe signature in APP13', jpeg(segment(0xed, [...ascii('Adobe'), 0, 1]))],
      ['an unknown APP14 kind', jpeg(segment(0xee, [...ascii('Other'), 0, 1]))],
      ...otherApps.map((marker) => [
        `APP${marker - 0xe0}`,
        jpeg(segment(marker, [...ascii('Any'), 0, 1, 2])),
      ]),
      // Every resource signature Photoshop writes, not "8BIM" alone.
      ...['8BIM', 'MeSa', 'PHUT', 'AgHg', 'DCSR'].flatMap((signature) => [
        ...[0x0422, 0x0423].map((id) => [
          `binary Exif in Photoshop resource 0x0${id.toString(16)} under ${signature}`,
          jpeg(photoshopWith(resource(id, exifBody([GPS_IFD_POINTER]), signature))),
        ]),
        [
          `a UTF-16 XMP packet in a Photoshop resource under ${signature}`,
          jpeg(photoshopWith(resource(0x0424, ascii('<x:xmpmeta/>').flatMap((c) => [c, 0]), signature))),
        ],
        [
          `a Photoshop XMP resource under ${signature} running past its segment`,
          jpeg(photoshopWith(resource(0x0424, ascii('<x:xmpmeta/>'), signature).slice(0, 16))),
        ],
      ]),
      [
        'a UTF-16 XMP packet in a Photoshop resource',
        jpeg(photoshopWith(resource(0x0424, ascii('<x:xmpmeta/>').flatMap((c) => [c, 0])))),
      ],
      [
        'a Photoshop XMP resource running past its segment',
        jpeg(photoshopWith(resource(0x0424, ascii('<x:xmpmeta/>')).slice(0, 16))),
      ],
      // A JPEG thumbnail inside JFXX is a whole JPEG, with metadata of its own.
      ['a JPEG thumbnail in JFXX', jpeg(segment(0xe0, [...ascii('JFXX'), 0, 0x10, 0xff, 0xd8]))],
      // Markers that are neither an image table nor a comment: never read.
      ...[0xf0, 0xf7, 0xfd, 0xc8, 0xde, 0xdf, 0x02, 0xbf].map((marker) => [
        `marker 0x${marker.toString(16)}`,
        jpeg(segment(marker, [...ascii('GPS'), 0, 1, 2])),
      ]),
      ['a second standard XMP packet', jpeg(xmp, xmpRest)],
      [
        'a Photoshop block split over two segments',
        jpeg(photoshop('<rdf:Description exif:GPSLat'), photoshop('itude="0,0N"/>')),
      ],
    ]) {
      expect(jpegLocation(bytes).readable, name).toBe(false);
    }
  });

  // Why: the allowlist must not refuse the kinds a stripped photo or an
  // exported web image ordinarily carries.
  it('reads the allowed segment kinds as clean', () => {
    const allowed = jpeg(
      JFIF,
      segment(0xe0, [...ascii('JFXX'), 0, 0x13, 1, 1, 0, 0, 0]),
      segment(0xe1, exifBody([MAKE])),
      segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]),
      segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0, 0]),
      segment(0xed, [
        ...ascii('Photoshop 3.0'),
        0,
        ...resource(0x0404, [0x1c, 2, 0]),
        ...resource(0x0424, ascii('<x:xmpmeta/>')),
        // The other resource signatures Photoshop writes are read the same way.
        ...['MeSa', 'PHUT', 'AgHg', 'DCSR'].flatMap((signature) => [
          ...resource(0x0404, [0x1c, 2, 0], signature),
          ...resource(0x0424, ascii('<x:xmpmeta/>'), signature),
        ]),
      ]),
      segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]),
      // The image tables and a comment a decoder needs or ignores.
      segment(0xdb, [0, ...Array(64).fill(1)]),
      segment(0xc4, [0, ...Array(16).fill(0)]),
      segment(0xdd, [0, 0]),
      segment(0xfe, ascii('a comment')),
      segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    );
    expect(jpegLocation(allowed)).toEqual({ readable: true, exifGps: false, xmpGps: false });
  });

  // Why: the image data is skipped, not parsed, and a progressive image has
  // several scans with segments between them: a location in a segment
  // between two scans is found, and the stuffed and restart bytes inside a
  // scan do not end it early.
  it('reads the segments between scans, skipping the image data', () => {
    const xmp = segment(0xe1, [
      ...ascii('http://ns.adobe.com/xap/1.0/'),
      0,
      ...ascii('<rdf:Description exif:GPSLatitude="0,0N"/>'),
    ]);
    const scanData = [1, 2, 0xff, 0x00, 3, 0xff, 0xd3, 4, 0xff, 0xff, 0x00];
    const bytes = Uint8Array.from([
      0xff,
      0xd8,
      ...JFIF,
      ...segment(0xda, [0, 0]),
      ...scanData,
      ...xmp,
      ...segment(0xda, [0, 0]),
      ...scanData,
      0xff,
      0xd9,
    ]);
    expect(jpegLocation(bytes)).toEqual({ readable: true, exifGps: false, xmpGps: true });
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
