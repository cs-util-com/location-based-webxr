# glb-chunks.ts

## Purpose

The one reader of a `.glb`'s chunk layout: the 12-byte header, the JSON
chunk and the optional binary chunk. It refuses, with plain words, any
bytes that are not exactly the shape glTF 2.0 binary allows. Every reader
of a model's chunks uses it, so they agree on which files are models at
all:

- `ar/tour-media.ts`: `checkGlbInert`, the tour's inertness check.
- The Tour Viewer's model optimizer (`editor/asset-shelf/glb-file.ts`,
  `readGlb`, and its writer's chunk type constants).
- The Tour Viewer's asset optimizer check page (`checks/asset-optimizer-check.ts`,
  `glbByteShares`, and `checks/asset-optimizer-check-page.ts`).

Deep import only: `gps-plus-slam-app-framework/utils/glb-chunks`, never
through the `/utils` barrel.

## Public API

- `GLB_MAGIC` (`glTF`), `GLB_CHUNK_JSON` (`JSON`), `GLB_CHUNK_BIN`
  (`BIN\0`): the little-endian words of the format.
- `readGlbChunks(bytes)`:
  - `{ ok: true, json, bin }`: `json` is the parsed JSON chunk (an object;
    its fields are still untrusted), `bin` the binary chunk's bytes as a
    view into `bytes`, or `null` when the file has none. A zero-length
    binary chunk is an empty view, not `null`.
  - `{ ok: false, reason }`, `reason` one of:
    - `it is not a .glb file`: a wrong magic, the input is no `Uint8Array`,
      or its buffer is detached (transferred away);
    - `it is too short to be a .glb`: under 20 bytes;
    - `only glTF 2.0 is supported`: a version other than 2;
    - `its JSON chunk is missing or truncated`: the first chunk is not JSON,
      or its length runs past the data;
    - `its declared length does not match the file`: the header's length
      is not the data's;
    - `it has a chunk other than one JSON and one binary chunk`: the second
      chunk is not binary;
    - `it has data past its last chunk, or a chunk that runs past the end`:
      a third chunk, trailing bytes, a stub of a chunk header, or a binary
      chunk longer than the data;
    - `its JSON chunk does not parse` / `its JSON chunk is not an object`.

## Invariants

- **Exactly the shape the format allows:** one JSON chunk, an optional
  binary chunk, then the end, with the header's length equal to the
  data's. three.js's loader walks every chunk and takes a later JSON chunk
  over the first, so a reader of the first chunk alone would pass a model
  whose second chunk points outside the file.
- **A JSON chunk need not be padded to 4 bytes.** The spec asks for the
  padding; three.js reads an unpadded chunk, and tours have always been
  allowed one, so refusing it would refuse tours that open today.
- The JSON is decoded as UTF-8 without the fatal flag (a broken sequence
  becomes U+FFFD), as before the readers were merged.
- Never throws, whatever the input, a view over a detached buffer included
  (the `DataView` constructor throws there; the reader refuses). Pure: no I/O, no DOM, no imports.
- Reads through `byteOffset`, so a view into a larger buffer reads right.

## Example

```ts
import { readGlbChunks } from 'gps-plus-slam-app-framework/utils/glb-chunks';

const read = readGlbChunks(new Uint8Array(await blob.arrayBuffer()));
if (!read.ok) throw new Error(`the file is no GLB: ${read.reason}`);
const views = read.json['bufferViews'];
const bin = read.bin ?? new Uint8Array(0);
```

## Tests

- `glb-chunks.test.ts`: both chunks, JSON only, a zero-length binary
  chunk, an unpadded JSON chunk, a view with an offset, and every reason
  word for word (too short, magic, version, first chunk not JSON or too
  long, header length, a second JSON chunk, a third chunk, a binary chunk
  past the end, a header stub, JSON that does not parse or is no object,
  input that is no bytes, a view over a detached buffer).
- `glb-chunks.property.test.ts`: never throws on random bytes (bare and
  behind a valid header); a generated well-formed GLB (JSON padded to 1, 2
  or 4 bytes, with or without a binary chunk) reads back exactly its
  chunks; every truncation of one is refused.
- The Tour Viewer's `editor/asset-shelf/glb-chunk-readers.test.ts` runs the
  tour's check, `readGlb` and `glbByteShares` on the same bytes and holds
  that they agree.
