# gpu-trainer.ts

## Purpose

The GPU trainer as the page sees it: a `TrainerAdapter` of kind `gpu`
that plans a stretch's job, refuses in words a stretch whose photos the
graphics card cannot hold, reads its photos from the recording, and
trains it in a worker running Splat.js, so the page stays responsive.

## Public API

- `WorkerLike` - the parts of a `Worker` it uses (`postMessage`,
  `terminate`, `onmessage`, `onerror`).
- `GpuTrainerDeps` - `{ gpu, readPhotos(recording, entries), spawn(),
timer: { now }, settings? }`.
- `createGpuTrainer(deps) -> TrainerAdapter`.
- Internal, not exported: `tooLargeFor(photos, width, height, limits,
settings) -> string | null` - why a stretch cannot train on a card with
  `limits` (`memoryBudgetBytes` then `photoScale` of `training-budget.ts`),
  in words; null when it fits or the sizes cannot be judged.
- `judgeGpuRun(result, { goodHeldOutDb, weakHeldOutDb }) -> WindowJudgement`.

## Behaviour

- `probe` is `probeWebGpu(gpu)`; the trainer keeps the newest result,
  and `trainWindow` probes itself when the page has not.
- `trainWindow`: says `loading` at once, then `planWindowJob`, then the
  card check: with the adapter's limits known, a stretch that
  `tooLargeFor` refuses ends as `failed` with that sentence and
  `retryHelps: false`, before any photo is read or worker started (the
  photo size Splat.js picks itself is not passed on). Then `readPhotos`
  for the job's entries (a failure ends as `failed`, "The stretch's
  photos could not be read from the recording (...)", `retryHelps:
false`), then one fresh worker per stretch, sent
  `{ type: "train", job, photos }`. Worker progress reaches the page with
  its stage and time to the next look; the worker's looks reach it as
  `onPreview`, and a look that arrives after the abort is closed instead
  (an `ImageBitmap` holds its pixels until closed). Its result is passed
  on with its `detail` and `retryHelps`. A worker error ends as
  `failed`, "The trainer stopped unexpectedly (...)", with a retry still
  offered.
- Stop: an abort ends the worker at once and the stretch as `cancelled`
  without a splat; no answer is awaited, so a stretch continued right
  after never runs beside a worker still winding down. An abort always
  reads as `cancelled`, whatever the worker finished before it heard of
  it. The worker is terminated on every path; no worker starts when the
  stop came first.
- `judge` (provisional thresholds, `trainer-defaults.ts`): a lost device
  or a failed run is poor; held-out sharpness of at least `goodHeldOutDb`
  is good, of at least `weakHeldOutDb` weak, below that poor; a run that
  ran out of time is at best weak; a stretch without a test set is weak.
  A failed run is judged by `failedJudgement`: "Training stopped: <detail>"
  (or "Training stopped with an error." without one), passing
  `retryHelps: false` on, so the page offers no "Train again" for it.
- The thresholds (20 dB good, 16 dB weak) are provisional and laxer than
  the plan's gate bars (good at 21 dB held out and 27 dB at the camera with
  SSIM 0.70; not good under 19 dB held out or 25 dB at the camera): this
  judge reads held-out sharpness only. 16-21 dB for "weak" and 19-22 dB for
  "good" are plausible; a measured judge against people's ratings decides.

## Tests

`gpu-trainer.test.ts` with a hand-driven fake worker and timer, on the
synthetic recording: a stretch trained with its photos in job order, a
stop ending the worker at once, a stop before the start, a lost device
and a deadline passed on, a refused library (its detail and
`retryHelps` passed on) and a crashed worker as failed in words,
unreadable photos, a stretch too large for the card refused before any
worker (probed first or not) and one that fits the default limits
trained, `loading` before the photos are read, looks passed on and a
late one closed; and the judge's thresholds and failure words.
