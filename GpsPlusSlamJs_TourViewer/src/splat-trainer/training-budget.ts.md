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
  - RangeError for sizes that are not positive integers.
- `iterationBudget(trainFrames, settings) -> number` -
  `itersPerFrame * trainFrames` within `[minIterations, maxIterations]`.
- `liveEta({ done, total, elapsedMs }, settings) -> number | null` - ms
  left at the measured rate; null before `etaMinIterations` steps (warm-up
  and shader compilation) or for a measurement that makes no sense.

## Invariants & assumptions

- The budgets never exceed the limits passed in: the memory budget is at
  most each limit, a photo size's bytes at most the budget, the steps
  within their bounds.
- Scaling keeps the photo's shape to within the pixel each side loses to
  rounding, and never upscales.
- The estimate is monotonic in the remaining steps at a fixed measured
  rate.
- `bytesPerPixel` 12 is the provisional working cost per pixel (see
  `trainer-defaults.ts.md`); a trainer whose real cost differs changes
  that value, not this code.

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
  budget, no upscale, the shape kept; steps within bounds; the estimate
  monotonic in the remaining steps.
