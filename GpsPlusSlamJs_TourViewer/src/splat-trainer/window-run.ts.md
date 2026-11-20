# window-run.ts

## Purpose

Trains one stretch with a loaded Splat.js: create the session, load the
photos, set the known cameras and seeds, train to the step budget or the
deadline, score, export and crop. Everything the browser owns (the
library, the clock, the abort signal) comes in, so every ending is
testable with a fake library.

## Public API

- `RunInput` - `{ photos: { name, blob }[], cameras, seeds, evalFrames,
maxIters, deadlineMs, keepM, trainPositions, etaMinIterations }`.
- `RunProgress` - `{ fraction, secondsLeft | null }`.
- `RunResult` - `{ outcome, metrics | null, trainingS, ply | null,
detail? }`; `detail` says why a `failed` run failed.
- `RunClock` - `{ now, setTimeout, clearTimeout }`.
- `runWindow(mod, input, onProgress, signal, clock) -> Promise<RunResult>`.

## Behaviour

- Session options: `maxIters`, `holdout: -1` (the named `evalFrames` are
  the test set), `evalHoldEvery` `max(1000, maxIters / 4)`, and
  `trainer: { camOpt: false, expComp: false }`. Splat.js shrinks the
  photos by its own memory budget.
- The run ends on Splat.js's `train-complete` event (`finished`), on the
  deadline timer (`deadline`), on its `device-lost` event (`gpu-lost`) or
  on the abort (`cancelled`), whichever comes first; a load or a seed
  under way is not waited for once the run must end.
- `finished` and `deadline` pause, score and export: `atCameraDb` is the
  mean `evalFramePsnr` over the cameras not in the test set, `heldOutDb`
  is `evalTestPsnr()` (null without a test set). The exported PLY is
  cropped to the splats within `keepM` of a training camera
  (`shellCrop` of `splat-ownership.ts`, then `cropPly`).
- `cancelled` and `gpu-lost` end without metrics or a splat; any throw
  ends as `failed` with its message in `detail`. Never rejects.
- Progress reports `iter / maxIters` with the time left from `liveEta`.
- On every path the abort listener is removed, the timer cleared, and the
  session paused and disposed.

## Tests

`window-run.test.ts` with a scripted fake library: a finished stretch
trained, scored, exported and cropped; a cancel during each stage (load,
seed, train, score, export) and before the start; a lost device during
load and training; the deadline; a throwing library; the progress and
time left; the abort listener removed.
