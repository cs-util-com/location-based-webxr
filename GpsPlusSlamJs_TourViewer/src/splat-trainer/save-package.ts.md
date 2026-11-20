# save-package.ts

## Purpose

Builds the file the splat trainer page saves: a zip with a manifest,
`splat-package.json`, and one splat per stretch that goes into the file.
A file from the practice trainer holds no splats and says it is a
placeholder (`placeholder: true`); a file from the GPU trainer holds the
cropped splat of each stretch it trained (`placeholder: false`).
`placeholder` follows the trainer (`state.trainer === "practice"`), and
the manifest names it in `trainer`.

Both are `version: 0`: the format is provisional, GPU-trained packages
included. Nothing reads these files yet; a reader written before the
format is settled must treat version 0 as provisional (fields may change
without notice) and must refuse `placeholder: true`. No version 1 exists
or is promised; the first settled format takes the next number.

## Public API

- `packageFileName(recordingName)` - `<name>-splat.zip`, the name kept to
  letters, digits, `.`, `_` and `-`, at most 80 characters, `recording`
  when nothing is left.
- Internal, not exported: `PACKAGE_MANIFEST` (`splat-package.json`),
  `PACKAGE_FORMAT` (`splat-package`), `PACKAGE_VERSION` (0 while the
  format is provisional, for every trainer), and `packageManifest(state, splats)` - `{
format, version, placeholder, trainer, note?,
walk: { photos, lengthM, photoWidth, photoHeight }, stretches: [{ number,
fromM, toM, photos, attempts, verdict, marked, reasons, atCameraDb,
heldOutDb, splat }] }`. Only stretches that go into the file are listed
  (`windowsInFile`); `marked` is true for anything not good.
- `buildPackage(state, splats) -> Promise<Blob>` - packs with the
  framework's `packFilesAsZip`.

## Invariants

- No recording file name, place or position goes into the manifest; the
  save dialog still warns that the splat itself shows the place.
- Splat paths are `stretches/NN.ply`, numbered like the prints.

## Tests

Through `trainer-page-store.test.ts`, which reads the saved zip back and
checks the placeholder manifest, its `trainer` and its stretch count.
