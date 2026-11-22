# import-step.ts

**Purpose:** the converter Worker's step: one import's files made into one `.glb` for the tour.

## Public API

- `ImportPayload`: `{ format: "gltf", name, files: [{ path, blob }] }` (the `.gltf` at `name` among the loose files) or `{ format: "zip", name, zip, model? }` (`model` the path of the model to make, as `listZipModels` lists it; checked to be a string when given).
- `convertImport(payload, settings, control, limits?)`: a `WorkerStepAnswer`:
  - `done { blob, extension: "glb", conversion: { notes, used } }`: `notes` what was left out in words (the repack's, then the zip's), `used` the given files the model carries (by path);
  - `kept { reason }`: a refusal in words; the page shows it with no Retry, since the same files would be refused again.
    Throws `the converter was handed no files it can read` for a payload that is no import (the page shows a failure with Retry), and an `AbortError` once `control.signal` aborted.
- `ImportStepLimits`: `maxBytes`, the loose files together before any is read (default `ASSET_CEILING_BYTES`; `refusal.tooLarge`).

## Invariants

- Loose files: summed against `maxBytes` first, then read one by one (abort checked after each, progress up to 0.8 by bytes), then `repackGltf`. A path given twice is read once (the first).
- Zip: `readZipBundle`, then `repackGltf` on its model, or its `.glb` as it is.
- Progress runs 0..1 and reaches 1 only with a model.
- The settings are not read: a conversion has no knobs; the shelf optimizes the result with its own.

## Tests

`import-step.test.ts`: loose files to an inert `.glb` with `used`, a missing `.bin` as `kept`, a folder zip with its notes, a `.glb` in a zip as it is, the model of a zip by its path, a zip with no model, bad payloads, abort, the size cap.
