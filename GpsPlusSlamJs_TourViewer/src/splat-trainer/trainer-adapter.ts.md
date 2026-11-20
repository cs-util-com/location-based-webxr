# trainer-adapter.ts

## Purpose

The interface between the splat trainer page and whatever trains a
stretch: the GPU trainer (`gpu-trainer.ts`), the page's default, and the
scripted practice trainer (`fake-trainer.ts`), behind the same interface.

## Public API

- `GpuProbe` - `{ kind: "ready" } | { kind: "integrated" } | { kind:
"no-webgpu", detail }`.
- `TrainRequest` - `{ window: PlannedWindow, attempt, timeScale, inputs,
recording: Blob }` (the recording file, for its photos);
  `timeScale` is 2 to the power `attempt - 1` (a retry gets twice the time).
- `TrainStage` - `loading | preparing | training | checking`: loading the
  trainer, preparing the graphics card (photos and seeds uploaded, before
  the first step), training, and checking the result (scoring, export).
- `TrainProgress` - `{ stage, fraction, secondsLeft | null, previewEveryS
| null }`; the practice trainer only ever says `training`.
- `TrainEvents` (internal, the type of `trainWindow`'s second argument) -
  `onProgress(progress)`, `onPreview(picture)`.
- `TrainOutcome` - `finished | deadline | gpu-lost | failed | cancelled`.
- `WindowMetrics` - `{ atCameraDb, heldOutDb | null, photosUsed }`.
- `WindowTrainResult` - `{ outcome, metrics | null, trainingS, ply: Blob
| null, detail?, retryHelps? }`: `detail` says why a `failed` run
  failed; `retryHelps: false` that a second try cannot fix it (a library
  that will not download, a photo that will not read, a stretch too large
  for the card).
- `WindowJudgement` - `{ verdict: good | weak | poor, reasons, say,
retryHelps? }`; `retryHelps: false` keeps "Train again" off the print.
- `failedJudgement(result)` - poor, "the trainer stopped", saying
  "Training stopped: <detail>" (or "Training stopped with an error."
  without one) and passing `retryHelps: false` on.
- `GpuProbe` - `ready` and `integrated` carry the adapter's `limits`
  (`maxStorageBufferBindingSize`, `maxBufferSize`) when it reports both as
  positive numbers; the GPU trainer's window check reads them.
- `TrainerAdapter` - `{ kind: "practice" | "gpu", probe(),
trainWindow(request, events, signal), judge(request, result) }`.
  `trainWindow` resolves `cancelled` once `signal` aborts.
- `probeWebGpu(gpu) -> Promise<GpuProbe>` - asks for a high-performance
  adapter. No `gpu`, no adapter, a fallback adapter or any throw is
  `no-webgpu`; vendor `intel` with an architecture that is not one of
  Intel's graphics-card families (Arc: `xe-hpg`, `xe2-hpg`), or an
  architecture or description naming integrated, UHD or Iris graphics, is
  `integrated`. `adapter.info` may say too little to be sure, so the page
  words this as likely ("seems to use"). Passes the adapter's memory
  limits on when both are positive. Never throws.

## Invariants and decisions

- `judge` lives on the adapter, so the page carries no verdict thresholds
  of its own; the GPU trainer's provisional rules are in `gpu-trainer.ts`.

## Tests

`trainer-adapter.test.ts`: every probe branch (missing, null adapter,
fallback, throwing, rejecting, built-in graphics, an Intel Arc card,
graphics card), and the memory limits passed on or left out.
