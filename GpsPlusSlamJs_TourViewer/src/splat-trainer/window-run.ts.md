# window-run.ts

## Purpose

Trains one stretch with a loaded Splat.js: create the session, load the
photos, set the known cameras and seeds, train to the step budget or the
deadline, score, export and crop (and ends in words when preparing the
graphics card outlasts its cap); it says which stage it is in and, given
a preview, draws looks at the model while it trains. Everything the browser owns (the
library, the clock, the abort signal) comes in, so every ending is
testable with a fake library.

## Public API

- `RunInput` - `{ photos: { name, blob }[], cameras, seeds, evalFrames,
maxIters, deadlineMs, prepareCapMs, keepM, trainPositions,
etaMinIterations, photoBudgetBytes? }`.
- `durationWords(ms)` - a duration in words ("5 min", "40 s"), also
  used by the worker's load cap.
- `RunProgress` - `{ stage, fraction, secondsLeft | null, previewEveryS |
null }` (`stage` a `TrainStage`; the run itself says `preparing`,
  `training` and `checking`, its caller `loading`).
- `RunPreview<P>` - `{ everyMs, take(trainer, ci) -> P | null, post(P) }`.
- `RunResult` - `{ outcome, metrics | null, trainingS, ply | null,
detail?, retryHelps? }`; `detail` says why a `failed` run failed,
  `retryHelps: false` that a second try cannot fix it.
- `RunClock` - `{ now, setTimeout, clearTimeout }`.
- `runWindow(mod, input, onProgress, signal, clock, preview?) ->
Promise<RunResult>`.

## Behaviour

- Session options: `maxIters`, `holdout: -1` (the named `evalFrames` are
  the test set), `evalHoldEvery` `max(1000, maxIters / 4)`, and
  `trainer: { camOpt: false, expComp: false }`. Splat.js shrinks the
  photos to a memory budget: `photoBudgetBytes` when given (as
  `frames: { targetBudgetBytes }`, the card's own budget), else its
  default.
- The run ends on Splat.js's `train-complete` event (`finished`), on the
  deadline timer (`deadline`), on its `device-lost` event (`gpu-lost`) or
  on the abort (`cancelled`), whichever comes first; a load or a seed
  under way is not waited for once the run must end.
- Preparation cap: from `preparing` until the session is seeded, one
  timer of `prepareCapMs` runs; when it fires first, the run ends as
  `failed` with "Preparing the graphics card took more than 5 min."
  (whole minutes from a minute on, else seconds), training never starts,
  and the session is disposed. The deadline timer replaces it once seeded.
- `finished` and `deadline` pause, score and export: `atCameraDb` is the
  mean `evalFramePsnr` over the cameras not in the test set, `heldOutDb`
  is `evalTestPsnr()` (null without a test set). The exported PLY is
  cropped to the splats within `keepM` of a training camera
  (`shellCrop` of `splat-ownership.ts`, then `cropPly` with the same
  reading, so the file is parsed once).
- `cancelled` and `gpu-lost` end without metrics or a splat; any throw
  ends as `failed` with its message in `detail`. Never rejects.
- Progress: `preparing` (fraction 0) before the photos load; `training`
  with `iter / maxIters` and the time left from `liveEta` at each of
  Splat.js's reports, never more than the deadline still allows (the
  smaller of the two); `checking` (the last fraction, no time left) once
  the run is paused, before it is scored and exported.
- Looks (with a preview): taken inside Splat.js's `metrics` report, which
  it awaits between training steps, so a look never interleaves with a
  step; the first at the first report, then at the first report at least
  `everyMs` after the previous look, and one more once the run is scored.
  `previewEveryS` is the interval, `everyMs` in seconds (null without a
  preview): a countdown sent only with each report stood still between
  reports.
  The camera is the middle test camera (`session.testCams`), else the
  middle camera not excluded from training. A `take` that returns null
  posts nothing; a throw from `take` or `post` is ignored.
- The view Splat.js offers (`session.view`) is not used: attached, it
  renders on its own about every half second during training, which takes
  time from the optimiser.
- On every path the abort listener is removed, the timer cleared, and the
  session paused and disposed.

## Tests

`window-run.test.ts` with a scripted fake library: a finished stretch
trained, scored, exported and cropped; a cancel during each stage (load,
seed, train, score, export) and before the start; a lost device during
load and training; the deadline; a preparation past its cap during
load and seed; a throwing library; the progress and time left, capped by
the deadline; the stages in order; the looks' timing, camera and final
look; the middle training camera without a test set; a look that throws;
the abort listener removed.
