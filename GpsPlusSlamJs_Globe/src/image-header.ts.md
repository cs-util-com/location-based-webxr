# image-header.ts - an image's type and size from its header

- Purpose: globe plan 2026-09-26-0539 §7.4. The fetch script checks every
  downloaded and every written image without decoding it: the type from
  the magic bytes, the size from the JPEG frame (SOF), the PNG IHDR header
  or the WebP's first chunk, and for a WebP whether it has alpha (the
  imagery tiles carry the water mask there: round-4 plan 2026-09-28-2105
  DEC-GL4-6).
- Public API: `imageInfo(bytes)` → `{ type: "jpeg" | "png", width, height }`,
  `{ type: "webp", width, height, alpha }`, or `null` when the bytes are
  not a complete image header.
- Invariants & assumptions:
  - JPEG: walks the segments from SOI; standalone markers (SOI, RST0-7)
    carry no length; the first frame marker (SOF0-SOF15, except DHT, JPG
    and DAC) gives the size; a truncated or malformed stream is `null`.
  - PNG: the 8-byte signature, then IHDR's big-endian width and height.
  - WebP: "RIFF", then "WEBP", then the first chunk: VP8X (flags with the
    alpha bit 0x10, 24-bit little-endian width - 1 and height - 1), VP8L
    (signature 0x2f, 14-bit width - 1, height - 1, one alpha bit) or VP8
    (start code 9d 01 2a, 14-bit width and height; never alpha). Any other
    chunk, a RIFF that is not WEBP, or fewer than 30 bytes is `null`.
  - Never reads past the buffer; a zero dimension is `null`.
- Tests: `image-header.test.ts` (crafted baseline and progressive JPEGs,
  PNG, a GIBS XML error body, truncation, a DHT segment before the frame;
  VP8X, VP8L and VP8 WebPs, a RIFF that is not WebP, a truncated WebP, an
  unknown chunk) and `.property.test.ts` (every 16-bit JPEG size and every
  24-bit VP8X size and alpha flag read back; random bytes never throw and
  never pass unless they start like an image).
