# jpeg-location.js

## Purpose

The byte-level reader behind the repo-config guard `photo-location-free.test.js`: does a JPEG carry the place it was taken? It answers whether a location block exists and never reads a value out of it, so neither the guard nor its failure can print a location.

## Public API

- `jpegLocation(bytes: Uint8Array)` returns one of:
  - `{ readable: true, exifGps, xmpGps }` - `exifGps` when an Exif APP1 segment's first IFD (IFD0) holds the GPS IFD pointer, `xmpGps` when an XMP APP1 packet names `GPSLatitude` or `GPSLongitude`;
  - `{ readable: false, reason }` - no start marker, a segment cut short or running past the file, an Exif header that is not TIFF, a first IFD outside its segment, a file that ends before its image data, or XMP the reader does not fully read: an ExtendedXMP segment (the continuation of a packet over 64 KB, split and possibly out of order), a standard packet that names `HasExtendedXMP`, or a packet with a NUL byte (UTF-16 or UTF-32, where the byte search for the property names would find nothing).
- `GPS_IFD_POINTER` - the tag `0x8825`.

## Invariants and defensive measures

- Never throws, on any bytes (a property test feeds random ones).
- Reads only the marker segments before the scan header (SOS) or the end marker; the image data is never parsed.
- Every offset is bounds-checked against its segment; anything that does not fit is `readable: false`, never a clean answer. The guard fails on that too, since a file nobody could check is not a clean one.
- Dependency-free: no Exif library decides what counts.
- Limits: the GPS pointer is looked for in IFD0, where the Exif standard puts it; JPEG only (no HEIC, PNG or WebP); XMP by property name, not by parsing the packet.

## Example

```js
import { readFileSync } from 'node:fs';
const result = jpegLocation(readFileSync('photo.jpg'));
if (!result.readable || result.exifGps || result.xmpGps) throw new Error('photo.jpg: strip its metadata');
```

## Tests

- `jpeg-location.test.js` - synthetic JPEGs: the pointer in either byte order behind a JFIF segment and other tags, Exif without it, no Exif, an XMP location, XMP it cannot fully read (ExtendedXMP alone, a packet pointing at it, both, a UTF-16 packet), damaged files and non-JPEGs; properties: the answer follows the pointer for any IFD, no throw on any bytes, no clean answer for any prefix of a file with a location.
- `photo-location-free.test.js` - the guard over every tracked JPEG.
