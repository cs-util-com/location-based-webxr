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
- `ToWorker` - a `TrainMessage` (the page stops a stretch by ending the
  worker, so nothing else is sent).
- `FromWorker` - `{ type: "progress", progress }`, `{ type: "preview",
picture: ImageBitmap }` or `{ type: "result", result }`.
- `WorkerTrainDeps<P>` - `{ load, decode, clock, preview? }`; `preview` is
  the run's `RunPreview<P>`, passed to `runWindow` as it is.
- `colourSampler(photo, width, height) -> ColourAt` - a camera pixel
  scaled to the decoded photo's size; null off the photo.
- `trainInWorker(msg, onProgress, signal, deps) -> Promise<RunResult>`.
- `serveTrainer(post, deps, train = trainInWorker) -> (msg) => void` -
  the worker's message handler: trains the first message's stretch only,
  posts its progress and result, and turns a rejected training into a
  `failed` result, "The trainer stopped unexpectedly (...)", so the page
  never waits on a worker that will not answer.

## Behaviour

- Never rejects. A photo list that does not match the job, a library that
  will not load, or a photo that will not decode ("A photo could not be
  read (...)") ends as `failed` with the sentence in `detail`. A library
  of the wrong version (`SplatJsMismatchError`) and a photo that will not
  decode carry `retryHelps: false` (a second try meets the same library
  and the same photo); a library that could not be downloaded leaves a
  retry on offer, since the network may be back.
- The load is capped by the job's `prepareCapMs`: a library that has not
  arrived by then ends as `failed`, "The splat trainer library did not
  arrive within <duration>.", with a retry on offer; the cap's timer is
  cleared on every path. An abort before training ends as `cancelled`.
  The job's `prepareCapMs` and `photoBudgetBytes` reach the run.
- The first progress, before the library is asked for, is `loading`.
- Only photos with depth samples or a shell flag are decoded; depth seeds
  are thinned by `seedVoxelM`, shell seeds by `shellVoxelM`.

## Tests

`worker-train.test.ts`: the sampler's scaling and edges, a refused
library before any decode (no retry), a library that could not be
downloaded (retry offered), a library that does not arrive within the
cap, only seeding photos decoded and their seeds
thinned, a decode failure in words, a mismatched photo list, a cancel
while seeding, `loading` said before the library arrives, and the
preview passed on to the run; `serveTrainer` posting a failed result for
a rejected training and training only the first message.
