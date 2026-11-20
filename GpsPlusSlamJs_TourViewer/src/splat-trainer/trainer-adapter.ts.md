# trainer-adapter.ts

## Purpose

The interface between the splat trainer page and whatever trains a
stretch: today the scripted practice trainer (`fake-trainer.ts`) and the
unavailable trainer below; later the GPU trainer, which plugs in behind
the same interface without the page changing.

## Public API

- `GpuProbe` - `{ kind: "ready" } | { kind: "integrated" } | { kind:
"no-webgpu", detail }`.
- `TrainRequest` - `{ window: PlannedWindow, attempt, timeScale, inputs }`;
  `timeScale` is 2 to the power `attempt - 1` (a retry gets twice the time).
- `TrainProgress` - `{ fraction, secondsLeft | null, nextPreviewInS | null }`.
- `TrainEvents` - `onProgress(progress)`, `onPreview(picture)`.
- `TrainOutcome` - `finished | deadline | gpu-lost | failed | cancelled`.
- `WindowMetrics` - `{ atCameraDb, heldOutDb | null, photosUsed }`.
- `WindowTrainResult` - `{ outcome, metrics | null, trainingS, ply: Blob | null }`.
- `WindowJudgement` - `{ verdict: good | weak | poor, reasons, say }`.
- `TrainerAdapter` - `{ kind: "practice" | "unavailable", probe(),
trainWindow(request, events, signal), judge(request, result) }`.
  `trainWindow` resolves `cancelled` once `signal` aborts.
- `probeWebGpu(gpu) -> Promise<GpuProbe>` - asks for a high-performance
  adapter. No `gpu`, no adapter, a fallback adapter or any throw is
  `no-webgpu`; vendor `intel`, or a description naming integrated, UHD or
  Iris graphics, is `integrated`. Never throws.
- `createUnavailableTrainer(gpu)` - probes for real; `trainWindow`
  rejects and `judge` throws "The splat trainer is not available yet."

## Invariants and decisions

- `judge` lives on the adapter, so the page carries no verdict thresholds
  of its own; the real verdict rules arrive with the real trainer.
- The page never calls `trainWindow` on the unavailable trainer: the slice
  allows starting only with the practice trainer.

## Tests

`trainer-adapter.test.ts`: every probe branch (missing, null adapter,
fallback, throwing, rejecting, built-in graphics, graphics card) and the
unavailable trainer's refusals.
