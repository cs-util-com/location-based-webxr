# save-package.ts

## Purpose

Builds the file the splat trainer page saves: a zip with a manifest,
`splat-package.json`, and one splat per stretch that goes into the file.
While only the practice trainer exists the zip holds no splats, and the
manifest says it is a placeholder (`placeholder: true`, version 0), so no
later reader can mistake it for a real package. `placeholder` follows the
trainer (`state.trainer === "practice"`), and the manifest names it in
`trainer`; a reader of real packages refuses version 0 and any
`placeholder: true`.

## Public API

- `packageFileName(recordingName)` - `<name>-splat.zip`, the name kept to
  letters, digits, `.`, `_` and `-`, at most 80 characters, `recording`
  when nothing is left.
- Internal, not exported: `PACKAGE_MANIFEST` (`splat-package.json`),
  `PACKAGE_FORMAT` (`splat-package`), `PACKAGE_VERSION` (0 while the
  format is a placeholder), and `packageManifest(state, splats)` - `{
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
