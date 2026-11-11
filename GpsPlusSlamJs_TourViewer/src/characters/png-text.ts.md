# png-text.ts

**Purpose:** reads and writes the few parts of a PNG file the character exchange needs (the chunk list, the header, one `tEXt` chunk), and tells a PNG from a JPEG by its first bytes, with no decoder.

## Public API

- `isPng(bytes)`, `isJpeg(bytes)`: signature checks; never throw.
- `PngChunk { type, start, data }`; `readChunks(bytes)`: every chunk up to and including `IEND`, each checksum verified. Throws `PngDamaged` on a missing signature, a chunk that runs past the end, a checksum mismatch or a file that ends before `IEND`.
- `pngHeader(chunks)`: `{ width, height, hasAlpha }` from `IHDR` (alpha from colour type 4 or 6, or a `tRNS` chunk), or `null` when there is no readable `IHDR`.
- `readTextChunk(chunks, key)`: the text of the first `tEXt` chunk with that key, or `null`.
- `withTextChunk(bytes, key, text)`: new bytes with one `tEXt` chunk for `key` placed before `IEND`; an earlier chunk with the same key is dropped. Key and text must be printable ASCII, else `RangeError`.
- `asciiJson(value)`: `JSON.stringify` with every character from U+007F upwards written as a `\uXXXX` escape, so any name fits a `tEXt` chunk and reads back unchanged.
- `crc32(bytes)`: the PNG checksum.

## Invariants

- Pure functions on `Uint8Array`; the input is never changed.
- Only `tEXt` is written (Latin-1 by the PNG rules); `asciiJson` keeps it plain ASCII so no tool can mangle it.

## Example

```ts
const out = withTextChunk(png, "gps-plus-slam-character", asciiJson(record));
readTextChunk(readChunks(out), "gps-plus-slam-character"); // the JSON text
```

## Tests

`png-text.test.ts` (signatures, chunk reading, each kind of damage, header alpha, the text round trip, same-key replacement, refusal of non-ASCII); `png-text.property.test.ts` (round trips for any text through `asciiJson` and a chunk, and damage detection).
