# depth-sample-codec.ts

## Purpose

The packed depth sample of scan pass S2
(`GpsPlusSlamJs_Docs/docs/2026-10-08-0640-scan-pass-s2-binary-depth-plan.md`):
a recorded `recording/recordDepthSample` action whose point grid is written
as bytes inside the action's JSON, about 17-18 times smaller per sample than
the JSON form, and read back to exactly the points the JSON form gave.

## Public API

- `DEPTH_SAMPLE_ACTION_TYPE` - `'recording/recordDepthSample'`.
- `MAX_PACKED_GRID_SIZE` - 64: the largest grid side either side accepts -
  the largest any app records (the Recorder's setting allows 2..64).
- `packDepthAction(action: unknown): unknown` - the action as the recording
  writes it. A depth sample the packed form holds exactly comes back as a
  new action with `payload.points: []` and `payload.grid`:
  - `v: 1`, `size: g`;
  - `depthF32`: the g x g depths, row-major, little-endian float32,
    unpadded base64url;
  - `rgb` (only when every point has a colour): 3 bytes per point, same
    order and encoding.
    Anything else - another action, a sample it cannot hold - comes back as
    the same object. Never throws.
- `unpackDepthAction(action: unknown): UnpackResult` - what every reader
  sees: `{ ok: true, action }` with a packed sample's points restored (and
  `grid` gone), any other action as it is; `{ ok: false, reason }` for a
  damaged packed grid.

## Invariants & assumptions

- **Lossless.** For every action, unpacking what was packed and written as
  JSON gives what the JSON form gave (the property test). A sample is packed
  only when:
  - its points form a full g x g grid (1 <= g <= 64) at the sampler's
    positions, `screenX = (col + 1) / (g + 1)`, `screenY = (row + 1) /
(g + 1)`, row-major (`depth-sampler.ts` `sampleGrid`; the depth-grid
    lookup indexes the same way);
  - every depth is finite and float32 (`Math.fround(d) === d`; WebXR's
    `getDepthInMeters` returns a float, so real samples always are);
  - every point has a colour of three integer bytes, or none does;
  - no point carries a key other than `screenX`, `screenY`, `depthM`,
    `rgb`.
    A depth of -0 is written as 0, as JSON writes it.
- **Old readers.** `points: []` stays in the packed payload, so a reader
  built before S2 sees a sample with no depth: every consumer copes (the
  occupancy grid loops zero times, the depth-grid lookup degrades, the QR
  size from depth needs 3 points).
- **The writer reads only.** The store holds the payload by reference and
  freezes it; packing builds a new action.
- **Never throws on write.** Any exception gives the action back unpacked:
  a throw in `writeAction` would fail every depth sample's write.
- **The bound binds both sides, so it may only ever be raised.** A packed
  grid wider than `MAX_PACKED_GRID_SIZE` is refused on read and its sample
  dropped; lowering the bound once packed recordings exist would drop their
  depth. (It fell from 128 to 64 before any packed recording shipped.) The
  Recorder's grid-size setting is held within it by a test
  (`recording-options.test.ts`, PR #569 review).
- **Untrusted on read.** A visitor's live join reads a tour's recording, so
  the decoder checks the version, the size (an integer in 1..64) and the
  text lengths of both fields BEFORE decoding or allocating, and refuses
  rather than throws. A grid written next to non-empty points is not one
  the writer makes; the points are kept as written.
- Uses the framework's strict base64url codec (`utils/qr-payload/base64url`),
  which is total and refuses non-canonical text.

## Examples

```ts
// The writer (opfs-storage.ts writeAction):
const json = JSON.stringify(packDepthAction(action));

// The shared parse (zip-reader.ts loadActionsFromEntries):
const read = unpackDepthAction(JSON.parse(text));
if (!read.ok) log.warn(`Skipping "${filename}": ${read.reason}`);
```

## Tests

- `depth-sample-codec.test.ts` - the two app shapes (16 x 16 without
  colour, 24 x 24 with), a one-point grid, every fallback, a frozen action,
  hostile payloads, -0, and every refusal of a damaged grid.
- `depth-sample-codec.property.test.ts` - any sampler grid and any point
  list read back as their JSON form; every finite sampler grid is packed.
- `zip-reader.test.ts`, `opfs-storage.test.ts` - the codec in the shared
  parse and in the writer.
