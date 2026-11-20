# training-budget.ts

## Purpose

How much a training window may hold and how long it trains: the photo
memory the adapter allows, the photo size that fits it, the number of
training steps, and the live time estimate. Pure: the caller passes the
adapter's limits (`GPUSupportedLimits`) in.

## Public API

- `memoryBudgetBytes({ maxStorageBufferBindingSize, maxBufferSize },
settings) -> number` - `min(targetMemoryBytes, binding / 2,
maxBufferSize)`, rounded down. RangeError for limits that are not
  positive numbers.
- `photoScale(frames, width, height, budgetBytes, settings) -> PhotoScale`
  - `{ kind: "fits", width, height, bytes }`: the photos' own size when
    `frames * width * height * bytesPerPixel` fits, else scaled down by
    one factor on both sides, rounded down;
  - `{ kind: "too-large", neededBytes, budgetBytes }` when the shorter
    side would fall under `minShortSidePx` (or the photo's own, if
    smaller): the window must be cut smaller.
  - RangeError for sizes that are not positive integers, or a
    `bytesPerPixel` that is not positive (at 0 every window would fit at
    full size in 0 bytes).
- `iterationBudget(trainFrames, settings) -> number` -
  `itersPerFrame * trainFrames` within `[minIterations, maxIterations]`.
  RangeError when `maxIterations < minIterations` (the clamp would
  return less than the minimum).
- `liveEta({ done, total, elapsedMs }, settings) -> number | null` - ms
  left at the measured rate. `done`, `total` and `elapsedMs` count from a
  mark the caller takes after warm-up (shader compilation, first upload),
  never from the start of training, or the one-off cost would skew the
  rate. Null before `etaMinIterations` steps since that mark, before any
  step at all (no rate yet, whatever the minimum), or for a measurement
  that makes no sense.

## Invariants & assumptions

- The budgets never exceed the limits passed in: the memory budget is at
  most each limit, a photo size's bytes at most the budget, the steps
  within their bounds.
- Scaling keeps the photo's shape to within the pixel each side loses to
  rounding, and never upscales.
- The estimate is monotonic in the remaining steps at a fixed measured
  rate.
- `bytesPerPixel` 12 and the 700e6-byte target are Splat.js's own
  planning numbers (see `trainer-defaults.ts.md`); a trainer whose real
  cost differs changes those values, not this code. Splat.js additionally
  caps the long side at 1600 px and floors it at 320 px; this module's
  floor is `minShortSidePx` on the short side.
- Positive-number checks use the shared `requirePositive`
  (`splat-math.ts`).

## Examples

```ts
const budget = memoryBudgetBytes(adapter.limits, TRAINER_DEFAULTS);
const size = photoScale(
  w.train.length,
  census.frameWidth,
  census.frameHeight,
  budget,
  TRAINER_DEFAULTS,
);
```

## Tests

- `training-budget.test.ts` - each limit binding the budget; native size,
  scaled size and too-large; steps clamped; the estimate's warm-up, rate
  and nonsense inputs.
- `training-budget.property.test.ts` - over random limits, sizes and
  settings: the memory budget under each limit; photo bytes under the
  budget, no upscale, the shape kept, and too-large exactly when the
  smallest allowed size (worked out independently) would not fit; steps
  within bounds; the estimate
  monotonic in the remaining steps.
