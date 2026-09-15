# `alignment-timing-loop.ts` - the measurement itself

## Purpose

Runs the timed passes and turns them into a per-fix cost at a growing stored
history. Pure: no library, no store, no DOM, no clock of its own.

## Public API

- `runAlignmentTiming(options): Promise<AlignmentTimingResult>` - runs
  `warmups + repeats` passes per arm, arms interleaved within each pass.
  - `options.armIds` - distinct ids, run in this order inside every pass.
  - `options.fixCount` - fixes in the recording; every pass applies all of them.
  - `options.ladder` - requested history rungs (see `resolveLadder`).
  - `options.repeats` / `options.warmups` - timed and discarded passes per arm.
  - `options.createPass(armId)` - returns the `(fixIndex) => void` for ONE pass,
    bound to a fresh, empty history. Called once per pass.
  - `options.now()` - monotonic milliseconds.
  - `options.onProgress(progress)` - after each completed pass.
  - `options.yieldControl()` - awaited between passes; never mid-pass.
  - Throws `RangeError` for a non-positive `fixCount` or `repeats`, a negative
    `warmups`, an empty arm list, or duplicate arm ids.
- `resolveLadder(ladder, fixCount): number[]` - sorted, de-duplicated, rungs at
  or above `fixCount` dropped, `fixCount` appended. Throws `RangeError` on a
  non-positive or non-integer rung or fix count.
- Types: `AlignmentTimingOptions`, `AlignmentTimingResult`,
  `AlignmentTimingArmResult`, `AlignmentTimingSegment`,
  `AlignmentTimingParameters`, `AlignmentTimingProgress`.

## Invariants and assumptions

- **The reported cost is MARGINAL, never mean.** A segment's cost is its own
  elapsed time over its own fix count, quoted at the segment's midpoint
  history. `total / fixCount` is the mean over a history growing from 1 to N -
  about half of what the app pays for its next fix, and quoting it would
  understate a budget by roughly a factor of two.
- **The segments partition `[0, fixCount]` exactly once, in order.** A gap would
  drop solves out of the reported cost; an overlap would charge them twice.
  Asserted as a property, not only by example.
- **Arms are interleaved within a pass.** Timing one arm's whole ladder before
  the next reads the device's load as if it were the configuration.
- **A fresh pass per arm per repeat.** The cost grows with stored history, so a
  reused history makes every repeat after the first dearer than reality.
- **The clock is read only at a rung boundary**, so no per-fix measurement
  contains a clock call of its own.
- **Warm-ups are excluded from the statistics and still reported** as whole-pass
  totals, so a reader can see how large the discard was.
- The median of an even number of repeats is the mean of the two middle values.

## Example

```ts
const result = await runAlignmentTiming({
  armIds: ['shipped', 'w180'],
  fixCount: 471,
  ladder: [50, 100, 200, 400],
  repeats: 5,
  warmups: 1,
  createPass: (armId) => createPassFactory({ plan, arms, createStore })(armId),
  now: () => performance.now(),
});
result.arms[0].segments.map((s) => [s.midHistory, s.medianMsPerFix]);
```

## Tests

- `alignment-timing-loop.test.ts` - interleaving, fresh passes, warm-up
  exclusion, marginal-vs-mean, median parity, minimum from kept repeats,
  per-arm separation, progress and yields, parameter echo, input refusals.
  All against a fake whose per-fix cost is history-dependent and known exactly.
- `alignment-timing-loop.property.test.ts` - ladder monotonicity and the
  segment partition, over arbitrary ladders and fix counts.
