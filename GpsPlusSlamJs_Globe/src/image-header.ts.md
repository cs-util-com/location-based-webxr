# image-header.ts - an image's type and size from its header

- Purpose: globe plan 2026-09-26-0539 §7.4. The fetch script checks every
  downloaded image without an image decoder (no dependency): the type from
  the magic bytes, the size from the JPEG frame (SOF) or PNG IHDR header.
- Public API: `imageInfo(bytes)` → `{ type: "jpeg" | "png", width, height }`
  or `null` when the bytes are not a complete image header.
- Invariants & assumptions:
  - JPEG: walks the segments from SOI; standalone markers (SOI, RST0-7)
    carry no length; the first frame marker (SOF0-SOF15, except DHT, JPG
    and DAC) gives the size; a truncated or malformed stream is `null`.
  - PNG: the 8-byte signature, then IHDR's big-endian width and height.
  - Never reads past the buffer; a zero dimension is `null`.
- Tests: `image-header.test.ts` (crafted baseline and progressive JPEGs,
  PNG, a GIBS XML error body, truncation, a DHT segment before the frame)
  and `.property.test.ts` (every 16-bit size read back; random bytes never
  throw and never pass unless they start like an image).
