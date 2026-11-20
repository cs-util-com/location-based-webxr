# recording-reader.ts

## Purpose

Turns a recorder zip (a `File` the creator drops, or any `Blob`) into what
a browser splat trainer needs: the camera captures with their raw WebXR
poses, one PINHOLE lens, the depth samples, a census shown before any
training, and a fingerprint of the file. Every refusal is a sentence a
creator can read. Nothing decodes a photo here.

## Public API

- `readSplatInputs(file, { limits? }) -> Promise<SplatInputsRead>`
  - `{ kind: "read", inputs }` or `{ kind: "refused", reason }`. Never
    rejects for a bad file; an invalid `limits` override (0, NaN) rejects
    with a `RangeError`, a programming mistake.
  - `limits` tightens the framework's archive caps (`ArchiveLimits`);
    the defaults are `DEFAULT_ARCHIVE_LIMITS`.
- `SplatInputs`
  - `captures: SplatCapture[]` - one per photo the zip carries, in
    recorded order: `entry` (the photo's archive entry), `position` and
    `rotation` (raw WebXR, metres, the recording's AR origin, exactly as
    recorded), `screenRotation`, `capturedAt` (epoch ms or null).
  - `intrinsics` - `pinholeFromProjection(projectionMatrix, frameWidth,
frameHeight)` from the framework, unchanged: it already is the
    continuous pixel convention, so no second half-pixel step is applied.
  - `projectionMatrix` - the first depth sample's matrix.
  - `depthSamples` - every depth sample with a well-formed projection
    matrix, pose and point list, packed samples unpacked by the
    framework's action reader.
  - `census` - `frames`, `skippedFrames`, `pathM`, `medianSpacingM`,
    `medianSpacingS`, `frameWidth`, `frameHeight`, `depthSamples`,
    `projectionSpread`, `era`.
  - `fingerprint` - `size`, `lastModified` (null for a plain Blob),
    `directoryHash` (SHA-256 hex of every file entry's name, unpacked size
    and CRC, in archive order).
- `PROJ_TOL` - 1e-4, the projection tolerance (below).

## Refusals

- Past an archive cap (file size, entry count, directory size, entry or
  total inflation): the framework's own `ArchiveLimitError` sentence.
- Not a zip: "This file is not a zip recording."
- No action entries: "This zip holds no recording (it has no actions)."
- No `session.json` in the recording's folder.
- An era below 4, missing or not an integer: `preflightCaptureJoin`'s own
  words, as a sentence ("The recording predates the current format (no
  migration here).").
- An era above `NEWEST_KNOWN_ODOM_COORD_VERSION`: "The recording is newer
  than this page understands; ...". The era rule's words would be untrue
  here, so these are new.
- Any segmenting action (`SEGMENTING_ACTION_TYPES`: a tracking restart or
  a loop closure): `preflightCaptureJoin`'s words ("The recording's
  coordinate frame changed mid-walk ..."). Refused rather than split: one
  rigid placement cannot hold both frames.
- No capture at all, or no capture whose photo the zip carries.
- A capture naming a photo with a pose that is not finite numbers.
- A kept capture without `width`/`height`, or two kept captures of
  different sizes (one lens fits one size).
- No depth sample with a projection matrix: "This recording has no depth
  data, so the camera's lens is unknown. Record with depth on."
- Projection matrices that differ beyond `PROJ_TOL`, naming the spread.
- A degenerate projection (`pinholeFromProjection` throws).
- Anything else that fails while reading (an action file over the
  framework's 1 MB action cap, a damaged entry): "The recording could not
  be read (...)".

## Invariants & assumptions

- **The recording's folder.** Photo entries are looked up under
  `recordingFolderOf` (`tour-read-set.ts`): `""` for a flat zip, the
  wrapping folder for a recording re-zipped from its folder. A photo of
  the same name in another folder is never taken.
- **Skipped captures** (naming no file, or a file the zip lacks) are
  counted in `census.skippedFrames`, never silently dropped. A file
  captured twice keeps its last pose, once, at its first position in the
  order, as the zip keeps its last write.
- **`PROJ_TOL`.** Per element, `|a - b| / max(|a|, |b|, 1)` against the
  first sample; the floor of 1 makes elements near zero compare in
  absolute terms. A session's matrix is constant up to float round-off
  (about 1e-7 in float32), while a real change of lens moves the focal
  terms by percent; 1e-4 sits between. A value that would change it: a
  device whose matrix drifts by more than 1e-4 within one session (none
  is known; the census reports the spread so it would show).
- **Caps.** One `DecompressionBudget` serves every read of the archive;
  text entries are read under `maxTextEntryBytes`, actions additionally
  under the framework's `MAX_ACTION_FILE_SIZE`. A file over
  `maxArchiveBytes` is refused before any byte is read. The zip is read
  lazily (directory, `session.json`, actions), never whole.
- **Census without decoding.** `pathM` sums the straight steps between
  consecutive kept captures; the medians are interpolating medians
  (`utils/median`), null below two captures (or two timed ones).

## Examples

```ts
const read = await readSplatInputs(file);
if (read.kind === "refused") showReason(read.reason);
else console.log(read.inputs.census.frames, read.inputs.intrinsics);
```

## Tests

- `recording-reader.test.ts` - on the synthetic walk
  (`test-support/synthetic-recording.ts`): poses round-trip, intrinsics
  equal `pinholeFromProjection` exactly with the principal point at the
  frame's centre, census exact, packed and unpacked depth read, the
  fingerprint stable and sensitive; skipped captures, a re-captured file
  and a wrapping folder; every refusal above with its words; each archive
  cap.
- `recording-reader.property.test.ts` - over walk length, spacing,
  timing, folder and missing photos (poses, counts, path); over eras and
  segmenting actions (exactly eras 4 and 5 without one are read); over
  projection jitter (accepted up to `PROJ_TOL` with the spread reported,
  refused beyond).
