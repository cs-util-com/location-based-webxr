# jpeg-location.js

## Purpose

The byte-level reader behind the repo-config guard `photo-location-free.test.js`: does a JPEG carry the place it was taken? It answers whether a location block exists and never reads a value out of it, so neither the guard nor its failure can print a location.

## Public API

- `jpegLocation(bytes: Uint8Array)` returns one of:
  - `{ readable: true, exifGps, xmpGps }` - `exifGps` when an Exif APP1 segment's first IFD (IFD0) holds the GPS IFD pointer, `xmpGps` when the body of any allowed APPn segment (an XMP packet in APP1, Photoshop's copy in APP13, the others too) names `GPSLatitude`, `GPSLongitude` or their `GPSDest` variants, in any case;
  - `{ readable: false, reason }` - no start marker, a segment cut short or running past the file, an Exif header that is not TIFF, a first IFD outside its segment, a file that ends before its image data, an APPn segment of a kind outside the allowlist (any APP3 to APP12 or APP15; in APP0 anything but JFIF or JFXX, in APP1 anything but Exif, standard XMP or ExtendedXMP, in APP2 anything but an ICC profile, in APP13 anything but `Photoshop 3.0`, in APP14 anything but `Adobe`: a camera's binary telemetry such as GoPro's GPMF in APP6 or a FLIR record in APP1 can hold a location no text search finds), a second standard XMP packet or a second Photoshop APP13 segment (a property name can be cut at the boundary of a split packet), a Multi-Picture (`MPF\0`) APP2 segment, any byte after the first image's end marker (a secondary image, a motion photo's video), or XMP the reader does not fully read: an ExtendedXMP segment (the continuation of a packet over 64 KB, split and possibly out of order), a standard packet that names `HasExtendedXMP`, or a packet with a NUL byte (UTF-16 or UTF-32, where the byte search for the property names would find nothing).
- `GPS_IFD_POINTER` - the tag `0x8825`.

## Invariants and defensive measures

- Never throws, on any bytes (a property test feeds random ones).
- Reads every marker segment up to the end marker, between scans too (a progressive image has several); the image data after each scan header is skipped, not parsed (a 0xFF followed by a stuffed zero, a restart marker or a fill byte does not end it), and the end marker must be the file's last bytes.
- Every offset is bounds-checked against its segment; anything that does not fit is `readable: false`, never a clean answer. The guard fails on that too, since a file nobody could check is not a clean one.
- Dependency-free: no Exif library decides what counts.
- Limits: the GPS pointer is looked for in IFD0, where the Exif standard puts it; JPEG only (no HEIC, PNG, WebP or MP4); a location by property name, not by parsing the packet; a COM segment is not searched; APPn kinds by an allowlist (JFIF and JFXX, Exif, XMP, ICC profile, Photoshop 3.0, Adobe), so a camera file with any other kind (HDR gain maps, motion photos, vendor records) fails closed by design, the accepted cost of never passing a binary location.

## Example

```js
import { readFileSync } from 'node:fs';
const result = jpegLocation(readFileSync('photo.jpg'));
if (!result.readable || result.exifGps || result.xmpGps) throw new Error('photo.jpg: strip its metadata');
```

## Tests

- `jpeg-location.test.js` - synthetic JPEGs: the pointer in either byte order behind a JFIF segment and other tags, Exif without it, no Exif, an XMP location, a location under its destination names, in any case and in Photoshop's APP13, XMP it cannot fully read (ExtendedXMP alone, a packet pointing at it, both, a UTF-16 packet), segment kinds outside the allowlist (GoPro telemetry in APP6, a FLIR APP1, unknown APP0, APP2, APP13 and APP14 kinds, every other APPn) and split packets (two standard XMP segments, a Photoshop block over two APP13s), the allowed kinds read as clean, metadata and images it does not read (an Exif or Adobe variant, a Multi-Picture segment, bytes or a second image after the end marker), segments between two scans, damaged files and non-JPEGs; properties: the answer follows the pointer for any IFD, no throw on any bytes, no clean answer for any prefix of a file with a location.
- `photo-location-free.test.js` - the guard over every tracked JPEG.
