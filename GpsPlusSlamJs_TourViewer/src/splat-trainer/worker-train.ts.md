# worker-train.ts

## Purpose

The trainer worker's work for one stretch, apart from its message
plumbing: say it is loading, load Splat.js, decode the photos that seed, build and thin the
seeds, and run the stretch (`window-run.ts`). The import, the decoder and
the clock come in, so the whole path runs in a unit test.

## Public API

- `DecodedPhoto` - `{ width, height, data }`, RGBA bytes row by row
  (`ImageData` has this shape).
- `TrainMessage` - `{ type: "train", job: WindowJob, photos: Blob[] }`,
  one photo per job photo, same order.
- `ToWorker` - a `TrainMessage` or `{ type: "cancel" }`.
- `FromWorker` - `{ type: "progress", progress }`, `{ type: "preview",
picture: ImageBitmap }` or `{ type: "result", result }`.
- `WorkerTrainDeps<P>` - `{ load, decode, clock, preview? }`; `preview` is
  the run's `RunPreview<P>`, passed to `runWindow` as it is.
- `colourSampler(photo, width, height) -> ColourAt` - a camera pixel
  scaled to the decoded photo's size; null off the photo.
- `trainInWorker(msg, onProgress, signal, deps) -> Promise<RunResult>`.

## Behaviour

- Never rejects. A photo list that does not match the job, a library that
  will not load, or a photo that will not decode ("A photo could not be
  read (...)") ends as `failed` with the sentence in `detail`; an abort
  before training ends as `cancelled`.
- The first progress, before the library is asked for, is `loading`.
- Only photos with depth samples or a shell flag are decoded; depth seeds
  are thinned by `seedVoxelM`, shell seeds by `shellVoxelM`.

## Tests

`worker-train.test.ts`: the sampler's scaling and edges, a refused
library before any decode, only seeding photos decoded and their seeds
thinned, a decode failure in words, a mismatched photo list, a cancel
while seeding, `loading` said before the library arrives, and the
preview passed on to the run.
