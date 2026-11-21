# splat-js.ts

## Purpose

Where the GPU trainer's library comes from and the part of it the trainer
uses. Splat.js (MIT licence, https://github.com/arrival-space/splat.js) is
loaded at run time from one pinned commit served by jsDelivr's GitHub
mirror, never bundled or vendored.

## Public API

- `SPLAT_JS_COMMIT` - the 40-hex commit the trainer was measured with.
- `SPLAT_JS_URL` - `https://cdn.jsdelivr.net/gh/arrival-space/splat.js@<commit>/src/index.js`,
  the one address the trainer loads.
- Types of what the trainer calls: `SplatCameraEntry` (one camera of
  `parseCameras`: OpenCV world-to-camera `R_w2c_rowmajor`, `t_w2c`, pixel
  intrinsics of a `width` x `height` photo), `SeedPoint` (`X`, `rgb` in
  0..1), `SplatMetrics`, `SplatEvent`, `SplatSessionLike` (with the
  session's `testCams`), `SplatTrainerLike` (its model: `iter`,
  `camMeta`, `excluded`, and for looks `device`, `canvasFormat` and
  `renderTrainCam(ci, ctx)`),
  `SplatJsModule` (and, unexported, the `createSession` options it takes).
- `checkSplatJs(mod) -> SplatJsModule` - throws "The splat trainer library
  is not the version this page expects (<what>)." for a non-object, a
  missing `createSession` or `parseCameras`, or a `TRAIN_MAX_DIM` that is
  not a positive number.
- `ModuleImporter` - `(url) => Promise<unknown>`.
- `SHIM_IMPORT_KEY` - the global under which the worker's `blob:` start
  module leaves its importer.
- `loadSplatJs(importer) -> Promise<SplatJsModule>` - imports
  `SPLAT_JS_URL` with `importer` and checks it; a failed import rejects
  with "The splat trainer library could not be loaded (<detail>)." The
  importer is required: there is no default `import()` here, because one
  written in a module this site serves would send this page's address as the Referer.

## Invariants and decisions

- The module has no version export, so the check reads the exports the
  trainer calls; the commit pin is what fixes the version.
- The session options name Splat.js's own switches: `camOpt` (camera
  refinement) and `expComp` (exposure compensation) are off, because the
  recording's poses and the at-camera scoring must stay comparable.
- The import runs in the trainer worker through its start module's
  importer, so the request for the entry carries no Referer; the entry's
  own imports of its sibling files name only that CDN file
  (`trainer-worker-spawn.ts`).

## Tests

`splat-js.test.ts`: the pinned address, the check's acceptance and each
refusal, and the loader with an injected importer (the address asked
for, a network failure and a wrong module, both in words).
