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
  - `limits` tightens the framework's archive caps (`ArchiveLimits`),
    resolved once by the framework's `resolveArchiveLimits` (defaults
    `DEFAULT_ARCHIVE_LIMITS`); the same resolved caps feed the budget and
    every cap check.
- `SplatInputs`
  - `captures: SplatCapture[]` - one per photo the zip carries, in
    capture-time order when every kept capture carries a time, else in
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
    `contentKey` (`tourFileKey` of `tour-file-key.ts`: a hash of the file
    entries' names relative to a shared wrapping folder, unpacked sizes
    and CRC-32s from the directory, so a same-size change of content
    changes it; the key the Tour Viewer already uses for a local file).
    It leaves out the tour kit's own authored files, so a tour and the
    recording under it share the key, and a re-zip that adds or drops a
    wrapping folder keeps it.
- `PROJ_TOL` - 1e-4, the lens tolerance (below).
- `ASPECT_TOL` - 0.02, the lens-to-photo shape tolerance (below).

## Refusals

- Past an archive cap (file size, entry count, directory size, entry or
  total inflation): the framework's own `ArchiveLimitError` sentence.
- Not a zip: "This file is not a zip recording."
- No action entries: "This zip holds no recording (it has no actions)."
- Action streams in more than one folder (`recordingFoldersOf`): "This
  zip holds more than one recording (first/, second/). Give the trainer
  one recording at a time." The framework's parser would replay both as
  one stream.
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
- A capture whose photo the zip carries, with a pose that is not finite
  numbers. A capture whose photo is missing is skipped before its pose is
  looked at, broken or not.
- A kept capture without `width`/`height`, or two kept captures of
  different sizes (one lens fits one size). The size judged is the kept
  capture's: a capture another one replaced has no say.
- No depth sample at all: "This recording has no depth data, so the
  camera's lens is unknown. Record with depth on."
- Depth samples, none with a projection matrix: "This recording's depth
  data does not include the camera's lens, so the lens is unknown.
  Recordings from a current recorder include it."
- Depth samples with a projection matrix, but none also with a readable
  camera pose and point list: "This recording's depth data carries the
  camera's lens, but its camera poses or depth points are unreadable, so
  the lens cannot be used."
- Lens elements that differ beyond `PROJ_TOL`, naming the spread.
- A degenerate projection (`pinholeFromProjection` throws).
- A lens whose pixels are not square within `ASPECT_TOL` on the photos'
  size (a frustum made for another frame shape): "The recording's lens
  does not fit the shape of its photos (it would stretch them by N %)."
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
  captured twice keeps its last pose, time and size, once, at the last
  capture's place, as the zip keeps its last write.
- **Order.** `capturedAt` is the XR frame time, monotonic within a
  session, while the order the captures were written in can differ (the
  photo encoding is asynchronous); so the captures are sorted by it
  (stably) when all carry one. One untimed capture keeps the recorded
  order for all, and `medianSpacingS` is then null.
- **`PROJ_TOL`.** Over the lens elements only (0 and 5 focal, 8 and 9
  centre: what `pinholeFromProjection` reads; the clip-plane elements 10
  and 14 may move without a change of lens), `|a - b| / max(|a|, |b|, 1)`
  against the first sample; the floor of 1 makes elements near zero compare in
  absolute terms. A session's matrix is constant up to float round-off
  (about 1e-7 in float32), while a real change of lens moves the focal
  terms by percent; 1e-4 sits between. A value that would change it: a
  device whose matrix drifts by more than 1e-4 within one session (none
  is known; the census reports the spread so it would show). One device
  measured: its spread was exactly 0 on two recordings, so the value
  refuses neither; other devices are not yet measured.
- **`ASPECT_TOL`.** `|fx / fy - 1|` with the photos' size. Real lenses
  show a fraction of a percent; a frustum for another frame shape is off
  by tens of percent. A value that would change it: a device whose
  genuine pixel aspect is off by more than 2 %, or a mismatch under 2 %
  that visibly stretches a splat.
- **Caps.** One `DecompressionBudget` serves every read of the archive;
  text entries are read under `maxTextEntryBytes`, actions additionally
  under the framework's `MAX_ACTION_FILE_SIZE`. A file over
  `maxArchiveBytes` is refused before any byte is read. The zip is read
  lazily (directory, `session.json`, actions), never whole.
- **Census without decoding.** `pathM` sums the straight steps between
  consecutive kept captures; the medians are interpolating medians
  (`utils/median`); `medianSpacingM` is null below two captures,
  `medianSpacingS` also when any kept capture carries no time.

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
  fingerprint stable and sensitive (also to a same-size change of
  content); capture-time order and the untimed fallback; skipped
  captures (one with a broken pose among them), a re-captured file (its
  size judged by the kept capture) and a wrapping folder; clip-plane
  changes accepted; every refusal above with its words; each archive cap
  (the directory cap included).
- `recording-reader.property.test.ts` - over walk length, spacing,
  timing, folder and missing photos (poses, counts, path); over eras and
  segmenting actions (exactly eras 4 and 5 without one are read); over
  lens jitter (accepted up to `PROJ_TOL` with the spread reported,
  refused beyond); over the non-lens elements (never a spread); over the
  lens's shape against the photos' (read within `ASPECT_TOL`, refused
  beyond).
