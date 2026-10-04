# `alignment-timing-arms.ts` - what is measured, and under which parameters

## Purpose

The configurations the timing page prices, plus the page's own parameters
(history ladder, repeat counts, warm-up count). Data only.

## Public API

- `TimingArm` - `{ id, label, overrides }`. `overrides` is an
  `AlignmentOverrides` or `null`.
- `TIMING_ARMS` - the four arms, shipped first:
  - `shipped` - `null`.
  - `exp3` - `{ gpsAccuracyExponent: 3 }`.
  - `thr10` - `{ outlierThresholdMeters: 10 }`.
  - `w180` - `{ timeWeightEnabled: false, recentWindowSeconds: 180 }`.
- `SHIPPED_ARM_ID` - `'shipped'`.
- `HISTORY_LADDER` - `[50, 100, 200, 400]`; the recording's full length is
  appended by the loop.
- `REPEAT_OPTIONS` - `[3, 5, 9]`; `DEFAULT_REPEATS` - `5`; `WARMUP_PASSES` - `1`.

## Invariants and assumptions

- **Every key is a public override key.** `ALIGNMENT_OVERRIDE_KEYS` is imported
  from the library rather than retyped, and a test checks each arm against it -
  an unknown key is rejected at dispatch, and four arms silently measuring the
  shipped configuration would look like a stable measurement.
- **`null` means the shipped configuration, and an arm is a WHOLE config.**
  `setAlignmentOverrides` replaces rather than merges.
- **The shipped arm is first**, because it is the denominator of every ratio the
  report prints.
- **`w180` switches the recency weighting off with the window.** Left on, the
  oldest fix inside the window is still weighted hundreds of times lighter than
  the newest, so the window would not be the variable under test.
- **The repeat count is swept, not fixed.** A verdict from one parameter value
  is provisional; on a noisy device the reader can spend 9 passes where a cell
  looks unstable.
- **One arm of the five-configuration set cannot be expressed here**: the
  fixed-seconds memory rung needs a knob the public override whitelist does not
  carry. The page says so on screen; see the module docstring.

## Example

```ts
for (const arm of TIMING_ARMS) {
  store.dispatch(setAlignmentOverrides(arm.overrides));
}
```

## Tests

`alignment-timing-arms.test.ts` - whitelist membership, the shipped arm's
position and `null`, distinct ids and non-empty labels, the swept repeat
options and the ordered ladder.
