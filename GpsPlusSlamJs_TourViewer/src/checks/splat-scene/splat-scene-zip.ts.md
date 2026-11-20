# splat-scene-zip.ts

## Purpose

Writes a walk through the synthetic splat scene as a recorder-shaped zip, so the splat trainer reads it exactly as it reads a phone's recording. Works in a browser and in node (photos come in as bytes).

## Public API

- `photoEntryName(index) -> string` - the photo entry of capture `index` (0-based), `images/frame-000001.jpg` for the first.
- `actionEntries(actions, folder?) -> ZipEntryInput[]` - one entry per action, `actions/000001.json` on, inside `folder` (with its slash). The reader's test recordings (`src/test-support/synthetic-recording.ts`) build their zips with these two as well.
- `zipSceneWalk(frames, width, height, name?) -> Promise<File>` - `frames` are `{ jpeg, depth }`; the depth sample's pose and time are the photo's too. Rejects with a RangeError for no frames or a size that is not a positive integer.

## Invariants & assumptions

- The zip holds `session.json` (`odomCoordVersion` the newest era the reader knows), one action file per action (`actions/000001.json`, ...) and the photos (`images/frame-000001.jpg`, ...).
- Per frame two actions, in this order: the depth sample, packed as the Recorder writes it (`packDepthAction`), then the photo capture (the reader's `CAPTURE_ACTION`) with position, rotation, screen rotation 0, time and the photo size.
- No wrapping folder and no tour files; the file is built with `packFilesAsZip`.

## Examples

```ts
const file = await zipSceneWalk(
  photos.map((jpeg, i) => ({ jpeg, depth: depthSamples[i] })),
  320,
  240,
);
```

## Tests

- `splat-scene-zip.test.ts` - a straight and a loop walk with placeholder photos are read by `readSplatInputs` whole (frames, size, depth samples, poses, square-pixel lens, depths within float32); the RangeErrors; the entry names. The rendered walk is covered by `playwright-tests/splat-scene-check.spec.js`.
