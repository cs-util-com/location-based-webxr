# still-detector.ts

## Purpose

Whether the phone has come to rest, from `devicemotion` rotation rates: the rule behind the cockpit's hands-off photo B. Pure functions over a plain state, so the slice keeps that state (`feature-match-slice.ts`, `handsOff.still`) and every threshold is unit- and property-tested without a DOM.

## Public API

- `StillConfig { threshold, dwellMs, maxGapMs, lostMs, moveLevel, moveMs }` and `STILL_CONFIG`, the values the page uses:
  - `threshold` 6 deg/s (`STEADY_THRESHOLD`, so the steady readout and "still" never disagree);
  - `dwellMs` 1500: how long the level has to stay at or below the threshold;
  - `maxGapMs` 500: a longer gap between usable readings starts the dwell again;
  - `lostMs` 2000: this long without a usable reading the sensor counts as lost;
  - `moveLevel` 30 deg/s and `moveMs` 300: what counts as the move a viewpoint pair needs before its B.
- `StillState { level, seen, lastT, stillSince, moveSince, moved }`; `MotionSample { t, rate }` (page clock, `RotationRate` as in `guided-model.ts`).
- `stillStart(t, needMove)`: the state at time `t`; with `needMove` the phone has to move first (`moved` false).
- `stillStep(state, sample, cfg?)`: the state after one reading.
- `stillFor(state)`, `isStill(state, cfg?)` (moved and still for the whole dwell), `stillProgress(state, cfg?)` (0..1, the meter ring), `readingsLost(state, now, cfg?)`.

## Invariants and assumptions

- **Input is validated like `motionStep`.** A rate that is null or not finite counts as missing; a reading without any finite rate, or whose sum overflows (`rateSum` returns null), moves no level and no time. A time that is not finite or runs backwards returns the very same state.
- **The level** is a moving average by time, seeded with the first reading (so a phone at rest is not first assumed still or moving): a reading weighs `1 - exp(-dt / tau)`, which is `motionStep`'s 0.2 at 60 Hz, so a phone reporting at 15 or 120 Hz rests within 150 ms of one at 60 Hz. Readings less than 1 ms apart count as 1 ms.
- **Missing readings are no evidence of stillness:** a gap past `maxGapMs` ends the stillness run (and a move run); a short one does not.
- **A move** has to last `moveMs` above `moveLevel` without a gap; it is latched once seen. The smoothed level stays above 30 about 130 ms past a jolt, so a tap's jolt of 100 ms is not a move and one of 600 ms is; at 15 Hz a jolt of 150 ms at 120 deg/s per axis is none either.
- The state stays finite for any input (property test).

## Parameter sweep (the values rest on it)

Synthetic traces at 60 Hz with a seeded generator (a stand 0.5 deg/s per axis, a hand 1.5, a shaky hand 2.5, carrying 40-120), 5 seeds. Every claim below is asserted in `still-detector.test.ts`:

- **Threshold** 2 to 16: a stand rests at 2 and 3, a hand fails at 2, a shaky hand at 3 and mostly at 4; from 6 to 16 every resting profile fires within dwell + 100 ms. No carry with 0.4 s pauses fires at any threshold up to 16, and a slow carry (8-20 deg/s per axis) never fires.
- **Dwell** 0.8 to 2.5 s: the dwell is what guards a pause while the phone is carried. A 1.2 s pause takes B at 0.8 s (5 of 5 seeds); at 1 s and from 1.5 s up, never.
- **What would reverse it:** a tester who pauses longer than the dwell while moving the phone gets B early. A lower threshold (4 or less) would never let a shaky hand take B by itself. Neither was measured on a real phone: the traces are synthetic.

## Example

```ts
let st = stillStart(performance.now(), false);
window.addEventListener("devicemotion", (ev) => {
  st = stillStep(st, { t: ev.timeStamp, rate: ev.rotationRate });
  if (isStill(st)) takePhotoB();
});
```

## Tests

- `still-detector.test.ts`: a stand, a hand and a carried phone; the smoothing by time (exact at 60 Hz, 15, 30 and 120 Hz within 150 ms, a short jolt at 15 Hz); a jolt restarts the dwell; the move a pair needs (a short jolt is none); short and long dropouts; bad rates, an overflowing sum, bad and backwards times; readings lost; the progress; and the sweep above, with its reversal checks.
- `still-detector.property.test.ts`: the state stays finite for any readings, `isStill` implies `moved`, a fast reading ends the stillness.
