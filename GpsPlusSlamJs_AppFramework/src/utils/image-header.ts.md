# image-header.ts - an image's type and size from its header

## Purpose

Tour kit K4 review R2 (`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`
§14): a page that decodes an image it has not measured can be made to
allocate gigabytes by a few kilobytes of crafted file. The tour kit reads
every raster image's size from its header, before any decode, and checks
it against one pixel cap (`ar/tour-media.ts` `TOUR_MAX_IMAGE_PIXELS`).

## Public API

- `imageInfo(bytes)` -> `{ type, width, height }` with `type` one of
  `jpeg`, `png`, `webp`, `gif`, `avif`, or `null` when the bytes are
  not a complete header of one of them.
- `imageInfoOfBlob(blob, probeBytes = 1 MiB)` - the same from a Blob's
  first bytes (the module-private `IMAGE_HEADER_PROBE_BYTES`), never reading
  a large image whole;
  `null` when the probe holds no complete header or the Blob cannot be read.
- Type `ImageHeaderInfo` (`type` is the union of the five).

## Invariants & assumptions

- JPEG: walks the segments from SOI (standalone markers carry no length);
  the first frame marker (SOF0-SOF15 except DHT, JPG, DAC) gives the size.
- PNG: the 8-byte signature, then IHDR's big-endian width and height.
- WebP: `RIFF`, `WEBP`, then the first chunk: VP8X, VP8L or VP8.
- GIF: `GIF87a`/`GIF89a`, then the logical screen (little-endian). A
  frame larger than the screen is clipped by the browsers' decoders.
- AVIF: an ISO-BMFF `ftyp` naming `avif` or `avis`, then
  `meta` > `iprp` > `ipco` > `ispe`; the LARGEST item size is taken, so a
  grid's tiles cannot hide the grid's size. A box that claims to run past
  the probe is cut there (a header read from a file's first bytes).
- Never throws, never reads past the buffer; a zero or unsafe size is
  `null`.
- **Unify note (DEC-H3):** the JPEG, PNG and WebP readers follow the
  Globe's fetch-script reader (`GpsPlusSlamJs_Globe/src/image-header.ts`,
  which also reads a WebP's alpha). The Globe does not depend on the
  framework, so it keeps its copy for now; moving it onto this one is filed
  as a follow-up in the K4 review fixes' report.

## Examples

```ts
const info = await imageInfoOfBlob(blob);
if (info === null || info.width * info.height > TOUR_MAX_IMAGE_PIXELS) {
  // refuse: never decoded
}
```

## Tests

- `image-header.test.ts` - crafted JPEG (baseline, progressive), PNG,
  WebP (VP8X), GIF and AVIF headers; an AVIF grid's largest item; an HEIF
  that is not AVIF; truncated headers, zero sizes, SVG text, empty bytes;
  `imageInfoOfBlob` from a large Blob's first bytes, and a JPEG frame past
  a small probe read as unknown.
- `image-header.property.test.ts` - every 16-bit JPEG and GIF size and
  every PNG size read back; random bytes never throw and never yield a
  size unless they start like an image.
