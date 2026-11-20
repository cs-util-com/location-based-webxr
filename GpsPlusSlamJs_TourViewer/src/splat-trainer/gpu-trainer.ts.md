# gpu-trainer.ts

## Purpose

The GPU trainer as the page sees it: a `TrainerAdapter` of kind `gpu`
that plans a stretch's job, reads its photos from the recording, and
trains it in a worker running Splat.js, so the page stays responsive.

## Public API

- `WorkerLike` - the parts of a `Worker` it uses (`postMessage`,
  `terminate`, `onmessage`, `onerror`).
- `GpuTrainerDeps` - `{ gpu, readPhotos(recording, entries), spawn(),
timer: { now, set, clear }, settings?, cancelGraceMs? }`.
- `createGpuTrainer(deps) -> TrainerAdapter`.
- `judgeGpuRun(result, { goodHeldOutDb, weakHeldOutDb }) -> WindowJudgement`.

## Behaviour

- `probe` is `probeWebGpu(gpu)`.
- `trainWindow`: says `loading` at once, then `planWindowJob`, then `readPhotos` for the job's entries
  (a failure ends as `failed`), then one fresh worker per stretch, sent
  `{ type: "train", job, photos }`. Worker progress reaches the page with
  its stage and time to the next look; the worker's looks reach it as
  `onPreview`, and a look that arrives after the abort is closed instead
  (an `ImageBitmap` holds its pixels until closed). Its result is passed
  on. A worker error ends as `failed`.
- Cancel: the worker is sent `{ type: "cancel" }`; its answer, or after
  `cancelGraceMs` (default 5 s) none, ends the stretch as `cancelled`
  without a splat. An abort always reads as `cancelled`, whatever the
  worker finished before it heard of it. The worker is terminated on
  every path; no worker starts when the stop came first.
- `judge` (provisional thresholds, `trainer-defaults.ts`): a lost device
  or a failed run is poor; held-out sharpness of at least `goodHeldOutDb`
  is good, of at least `weakHeldOutDb` weak, below that poor; a run that
  ran out of time is at best weak; a stretch without a test set is weak.
- The worker's `detail` for a failed run is not shown yet: the page says
  "Training stopped with an error."

## Tests

`gpu-trainer.test.ts` with a hand-driven fake worker and timer, on the
synthetic recording: a stretch trained with its photos in job order, a
cancel answered, a cancel not answered within the grace time, a stop
before the start, a lost device and a deadline passed on, a refused
library and a crashed worker as failed, unreadable photos, `loading`
before the photos are read, looks passed on and a late one closed; and
the judge's thresholds.
