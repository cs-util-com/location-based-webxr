# trainer-defaults.ts

## Purpose

The splat trainer's tuning values in one constants block, so a sweep
that settles them changes one file. `windowM` and `itersPerFrame` are
measured; every other value is PROVISIONAL until the sweep that measures
it has run.

## Public API

- `TrainerSettings` - the tuning read by the window plan
  (`walk-windows.ts`), ownership (`splat-ownership.ts`) and the budgets
  (`training-budget.ts`). Every function takes it as a parameter, so a
  test or a sweep passes its own values without touching the defaults.
- `TRAINER_DEFAULTS` - the values below, frozen.

## The values, their swept range, and what would move them

- `jumpSpeedMPerS` 3 (swept 2 / 3 / 5): a walk is about 1.4 m/s. Lower
  would cut brisk walks into pieces; higher would let a tracking
  relocalisation through as a step.
- `holdoutEvery` 8 (4 / 8 / 16): every 8th capture is for evaluation
  only. Fewer hold-outs give a noisy score, more starve training.
- `minHoldouts` 5 (3 / 5 / 8): a window with fewer borrows its
  neighbours'. A score that single frames still swing at 5 would raise
  it.
- `windowM` 30, measured over 15 / 30 / 60: held-out quality moved by
  -0.8 to +1.2 dB with no consistent direction, while the wall time per
  window was about 2.3 / 4 / 9 min. Windowed training stayed within -1.4
  to +1.2 dB of training the whole walk at once: windows are a time and
  memory measure, not a quality gain. A device that cannot hold 30 m of
  photos at a useful size would lower it.
- `minFrames` 20, `maxFrames` 100: training captures per window; the plan
  requires `maxFrames >= 2 * minFrames`.
- `overlapFraction` 0.25 (0 / 0.15 / 0.25 / 0.4): how far into its
  neighbours a window trains, as a fraction of `windowM`. Visible seams
  would raise it; memory pressure would lower it.
- `ownRangeM` 40 (20 / 40 / 80): a camera claims the splats it sees within
  this range first.
- `keepFraction` 0.8 (0.5 / 0.8 / 1.0): a window keeps splats within this
  fraction of the background shell's distance from one of its cameras.
- `itersPerFrame` 150, measured against 300: the doubled steps gained
  only at the training cameras, held-out quality flat within 0.4 dB.
  Within `minIterations` 4000 and `maxIterations` 30000 (provisional).
- Measured trainer choices outside this block, for the training step that
  reads it: camera pose optimisation off, blur gate off.
- `targetMemoryBytes` 700e6 bytes (decimal, not 700 MiB) and
  `bytesPerPixel` 12: the photo memory target before the adapter's own
  limits (`training-budget.ts`). Both are Splat.js's own numbers, read
  from its pinned source (`src/io/frames.js`): it shrinks its photos so
  that `frames * width * height * 12` (three float32 channels) stays under
  `TARGET_BUDGET_BYTES = 700e6`, caps the long side at 1600 px and never
  shrinks it under 320 px. Planning with the same budget makes "native
  size" here mean native size there. Its real photo buffer is smaller (4
  bytes a pixel, checked against `maxStorageBufferBindingSize`), so the
  12 is the trainer's planning rule, not its allocation.
- `gpuBytesPerPixel` 4: what that real buffer holds a photo pixel in
  (Splat.js packs its training photos as RGBA8, `src/gs/trainer.js` at
  the pinned commit). The card's limits are converted with it into the
  budget's 12-byte count (`training-budget.ts`): half a 128 MiB binding
  is a 192 MiB budget, not 64 MiB. Not a tuning value but a fact of the
  pinned library; a Splat.js that stored float targets (16 bytes) would
  change it, and with it which stretches a small card refuses.
- `minShortSidePx` 128 (64 / 128 / 256): the smallest photo side a window
  may be scaled to before it is refused as too large. The GPU trainer
  counts the larger of it and Splat.js's own floor (`SPLAT_JS_MIN_TRAIN_DIM`,
  320 px on the longer side), which is 240 px short for 4:3 photos, 180 px
  for 16:9 and 128 px at 2.5:1. So at 128 it is inert for camera photos
  and binds only for photos wider than 2.5:1; 64 changes nothing either,
  and of the range only 256 changes which stretches are refused (4:3 and
  wider). Lowering it cannot make a stretch fit, since the library will
  not shrink below its floor; unusable splats near the floor would raise
  it, which is what the knob is for.
- `etaMinIterations` 200: steps measured before a time estimate shows.

The GPU trainer's values below are provisional: they are set from the
synthetic scene's acceptance run and await field recordings.

- `depthMaxDtMs` 200: a depth sample seeds a photo only when it was taken
  within this time of the photo. Larger pulls readings from a moved
  camera; smaller loses readings on a slow recorder.
- `seedVoxelM` 0.05: depth seeds sharing a 5 cm cube merge into one.
- `shellDistanceM` 40, `shellGridPx` 48, `shellEveryPhoto` 4,
  `shellVoxelM` 1: a background shell of one point per 48 px square at
  40 m, on every 4th training photo, merged per 1 m cube; it gives sky
  and far facades a start. The shell crop keeps `keepFraction` of
  `shellDistanceM` around the training cameras.
- `deadlineS` 1200: the longest a first try may train (a retry gets
  `timeScale` times it); the run then ends as `deadline`.
- `prepareCapS` 300 (considered 120 / 300 / 600, not measured): the
  longest loading the trainer library and preparing the graphics card
  (photo upload, seeding) may take together, one deadline from the
  worker's start, before the stretch fails in words (two caps one after
  the other would leave the print stuck for twice it); a retry gets `timeScale` times it.
  120 s would likely cut off a slow integrated card uploading 100 photos;
  600 s leaves a stuck print up for ten minutes. A measured upload time
  over 300 s on a real card would raise it.
- `goodHeldOutDb` 20, `weakHeldOutDb` 16: the judge's held-out sharpness
  for good and weak; below weak is poor. Provisional, and laxer than the
  stricter bars the trainer aims for (good at 21 dB held out and 27 dB at the camera with
  SSIM 0.70; not good under 19 dB held out or 25 dB at the camera): this
  judge reads held-out sharpness only. A judge measured against people's
  ratings replaces both.

## Invariants & assumptions

- Nothing reads the defaults implicitly: each consumer validates the
  settings it is given and throws a RangeError for values that cannot
  hold.

## Examples

```ts
const plan = planWindows(captures, { ...TRAINER_DEFAULTS, windowM: 15 });
```

## Tests

None of its own: a constants block. Its consumers' property tests draw
the settings over the swept ranges above.
