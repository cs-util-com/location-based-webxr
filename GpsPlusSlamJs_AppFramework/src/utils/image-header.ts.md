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
  not a complete header of one of them. A WebP's result also carries
  `alpha`: whether its header says the image has alpha.
- `imageInfoOfBlob(blob, probeBytes = 1 MiB)` - the same from a Blob's
  first bytes (the module-private `IMAGE_HEADER_PROBE_BYTES`), never reading
  a large image whole;
  `null` when the probe holds no complete header or the Blob cannot be read.
- Type `ImageHeaderInfo`: a union on `type`; only the `webp` member has
  `alpha`.

## Invariants & assumptions

- JPEG: walks the segments from SOI (standalone markers carry no length);
  the first frame marker (SOF0-SOF15 except DHT, JPG, DAC) gives the size.
- PNG: the 8-byte signature, then IHDR's big-endian width and height.
- WebP: `RIFF`, `WEBP`, then the first chunk: VP8X (the alpha flag 0x10
  of its flags byte, then 24-bit width - 1 and height - 1), VP8L (the 0x2f
  signature, then 14-bit width - 1, height - 1 and an alpha bit) or VP8
  (simple lossy, never alpha).
- GIF: `GIF87a`/`GIF89a`, then the logical screen (little-endian). A
  frame larger than the screen is clipped by the browsers' decoders.
- AVIF: an ISO-BMFF `ftyp` naming `avif` or `avis`, then
  `meta` > `iprp` > `ipco` > `ispe`; the LARGEST item size is taken, so a
  grid's tiles cannot hide the grid's size. A box that claims to run past
  the probe is cut there (a header read from a file's first bytes).
- Never throws, never reads past the buffer; a zero or unsafe size is
  `null`.
- **The one image-header reader of the workspace.** The Globe's fetch
  script (`GpsPlusSlamJs_Globe/scripts/fetch-globe-assets.mjs`) imports it
  by its source path and refuses an imagery tile whose WebP header states
  no alpha (the tiles carry their water mask in it); the Globe's own copy
  was removed.
- **Imports nothing**: the Globe's fetch script loads this file under
  plain node, which does not resolve the framework's `./x.js` import
  spellings to their `.ts` sources, and the script runs only by hand, so
  an import would break it with every gate green. A test in
  `image-header.test.ts` fails on any import or re-export in the file.

## Examples

```ts
const info = await imageInfoOfBlob(blob);
if (info === null || info.width * info.height > TOUR_MAX_IMAGE_PIXELS) {
  // refuse: never decoded
}
```

## Tests

- `image-header.test.ts` - crafted JPEG (baseline, progressive), PNG,
  WebP (VP8X, VP8L and VP8, with and without alpha; a RIFF that is not
  WebP, a truncated one, an unknown chunk), GIF and AVIF headers; an AVIF grid's largest item; an HEIF
  that is not AVIF; truncated headers, zero sizes, SVG text, empty bytes;
  `imageInfoOfBlob` from a large Blob's first bytes, and a JPEG frame past
  a small probe read as unknown; the source file holds no import. Its
  exact `toEqual` results pin that only a WebP result carries `alpha`.
- `image-header.property.test.ts` - every 16-bit JPEG and GIF size,
  every PNG size, and every extended (24-bit) and lossless (14-bit) WebP
  size with its alpha read back, the extended one under every value of
  the other VP8X flag bits; random bytes never throw and never yield a
  size unless they start like an image.
