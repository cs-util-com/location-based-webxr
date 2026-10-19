# position-precision.ts

## Purpose

One-line: one judgement, shared by every app, of how precise the position an
app works with is right now (`'code'`, `'gps'` with a number, or `'none'`),
whether it is too weak to guide by, and whether it can tell two targets a
given distance apart.

Deep import only: `gps-plus-slam-app-framework/state/position-precision`.
It is not on the `state` barrel or the root barrel. It has no consumer in
this package; apps adopt it (built per-file by `config/tsdown.config.ts`,
and a knip entry until a consumer exists).

## Public API

- `positionPrecision(input): PositionPrecision` - the judgement. `input`:
  - `position`: `'aligned'` (the aligned camera), `'lone-fix'` (a device fix
    standing in for it), or `null` (the app has no position: no alignment it
    may use and no fresh fix, a tracking drop). Which one is the app's call.
  - `codeHold`: the app's own statement that a code still holds its
    alignment. When that ends is the app's: on events (a code judged moved,
    a new odometry frame, leaving AR, another tour), never by the clock.
  - `gpsPoints`: the store's GPS readings, oldest first (`GpsPoint[]` fits;
    only `latLongAccuracy` and `source` are read).
  - `loneFixAccuracyM?`: the lone fix's own reported accuracy.
  - `ceilingM?`: default `POSITION_PRECISION_CEILING_M`; `RangeError` unless
    positive and finite (a caller bug).
- `PositionPrecision`: `{ source: 'code' | 'gps' | 'none', accuracyM:
number | null, tooWeak: boolean }`.
- `canTellApart(precision, spacingM, { factor? })`: whether the position
  can tell apart two targets `spacingM` apart (for a set of targets: the
  distance to the nearest other one). `factor` defaults to
  `TELL_APART_FACTOR`; `RangeError` unless positive and finite.
- Constants: `POSITION_PRECISION_CEILING_M` (25),
  `DEVICE_ACCURACY_WINDOW_FIXES` (10), `CODE_HELD_ERROR_M` (1),
  `TELL_APART_FACTOR` (1.25). Each doc comment carries its evidence and
  the value that would reverse it.
- Types: `PositionKind`, `PrecisionSource`, `PrecisionGpsPoint`,
  `PositionPrecisionInput`, `CanTellApartOptions`.

## The rule

- No position: `'none'`.
- An aligned position a code holds: `'code'`, `accuracyM` null (it shows as
  "code", never as a number that looks measured), never too weak.
- Otherwise the device accuracy: the interpolating median of the latest 10
  DEVICE fixes (by `gpsPointSourceOf`) with a finite, positive accuracy; for
  a lone fix, the worse of that median and the fix's own. A code never
  vouches for a lone raw fix.
  - Known: `'gps'`, too weak when above the ceiling (equal still guides).
  - Unknown (no device fix states an accuracy): `'none'` - with no code
    nothing speaks for the position's precision (codes-only mode once a
    code's hold ended).
- `tooWeak` is true for `'none'` too, so a reader that checks only
  `tooWeak` never guides on nothing.
- `canTellApart`: never for `'none'` or too weak; otherwise
  `factor x length <= spacing / 2`, where the length is the accuracy for
  `'gps'` and `CODE_HELD_ERROR_M` for `'code'`. A zero, negative or NaN
  spacing never; an infinite one (no other target) always, for a usable
  position.

## Invariants & assumptions

- **Device fixes only.** A synthetic reading (the store's code readings carry
  a fixed accuracy of their own) or an unknown stamp never enters the
  accuracy; the result equals the one on the device fixes alone (property
  test).
- **No clock.** Nothing reads a timestamp; a code's hold ends only through
  the app's `codeHold` (property test: every timestamp moved, same result).
- **Monotone.** The same fixes reported worse never read as more precise:
  never a smaller number, never too weak turning usable, never a no turning
  into a yes. `canTellApart` is monotone in the spacing and the factor.
- **An aligned verdict ignores the lone fix.** An old or wild lone fix never
  changes the judgement of an aligned position; a lone fix is never judged
  better than the aligned position on the same fixes.
- **`'none'` is never usable**: too weak, no number, tells nothing apart.
- **Defensive.** Accuracies from the store are external data: missing,
  NaN, infinite, zero or negative ones are no accuracy at all (skipped, and
  they take no slot in the window). A `'gps'` precision built by hand with
  no usable number tells nothing apart. Bad caller parameters throw.
- **What this module does not know:** stations, tours, radii, bands, the
  heading, the tracking report. Which position is judged and the target
  geometry stay the app's. The tracking report's GPS sub-score is
  unchanged and separate.

## Examples

```ts
import {
  canTellApart,
  positionPrecision,
} from 'gps-plus-slam-app-framework/state/position-precision';

const precision = positionPrecision({
  position: alignmentReady ? 'aligned' : freshFix ? 'lone-fix' : null,
  codeHold: codeStillHolds,
  gpsPoints: selectGpsPositions(store.getState()),
  loneFixAccuracyM: latestFix?.latLongAccuracy ?? null,
});
// Display: precision.source === 'code' ? 'code' : precision.accuracyM
if (!canTellApart(precision, nearestOtherTargetM)) {
  /* e.g. ask for a code scan */
}
```

## Tests

- `position-precision.test.ts` - the constants; `'code'` for an aligned
  position a code holds (codes-only too); `'none'` with no position; the
  median of device fixes only; the window of 10 usable fixes; both sides of
  the ceiling and a caller ceiling; the lone fix's worse-of and that a code
  never vouches for it; an aligned verdict ignores the lone fix; no code and
  no device accuracy is `'none'`; `canTellApart`'s boundary for GPS and a
  code, `'none'` and too weak, the spacing's edge values, a caller factor,
  a `'gps'` precision with no usable number.
- `position-precision.property.test.ts` - device fixes only; no clock;
  `'code'` exactly for a held aligned position; `'none'` only without
  evidence and then never usable; monotone under worse fixes; lone fix never
  better and an aligned verdict independent of it; `canTellApart` monotone
  in spacing and factor; a code tells apart whatever a GPS position at the
  code-held length or worse can.
- `position-precision.sweep.test.ts` - the evidence below.

## Evidence (`position-precision.sweep.test.ts`)

A visitor stands at one of a row of five targets; "right" is the share of
positions whose nearest target is the visitor's, at the three inner targets.
GPS: Gauss-Markov error (wander 0.6, white 0.3 of the accuracy, 20 s), 1 Hz,
60 s per target, 40 seeds; true accuracy 1-40 m, spacing 3-50 m (208
cells); the rule reads the reported accuracy, 0.5x/1x/2x the true one.
`POSITION_PRECISION_SWEEP_OUT=<file>` writes every cell.

- Honest report, ceiling 25 m, 90 % goal (yes / unsafe yes / needless no /
  worst yes):
  - factor 0.75: 116 / 25 / 0 / 71 %
  - factor 1: 103 / 12 / 0 / 85 %
  - **factor 1.25: 89 / 0 / 2 / 92 %** (shipped)
  - factor 1.5: 79 / 0 / 12 / 97 %
  - factor 2: 65 / 0 / 26 / 99.5 %
  - factor 3: 46 / 0 / 45 / 100 %
- The goal decides the factor: 80 % takes 1, 90 % 1.25, 95 % 1.5.
- The report decides it too: a phone reporting half its true error needs 2.5
  (1.25 then gives 35 unsafe yeses, worst 63 %); one reporting double is
  safe at 0.75 (1.25 then refuses 36 cells it could answer).
- Standing anywhere within a quarter of half the spacing of the target
  instead of its centre: 1.25 stays safe (worst yes 92 %).
- The ceiling (10-50 m): never an unsafe yes; from 20 m up no verdict
  changes; 10 m and 15 m add 6 and 1 needless no's.
- Re-run with two other seed sets at 80 seeds: the same verdicts, worst yes
  at 1.25 between 92.4 % and 92.8 %.
- A GPS-only museum (3-6 m spacing) is a no at every accuracy above about
  2.4 m - the case a code exists for.
- A code (`CODE_HELD_ERROR_M` 1 m: yes from 2.5 m of spacing), constant
  error 0-2 m per walk plus jitter 0.05-0.5 m: every yes at least 90 % right
  up to 1 m of error with 0.25 m of jitter. 1 m with 0.5 m of jitter gives
  85 % at 2.5 m; 1.5 m of error gives 63-85 % at 2.5-3 m; 2 m gives
  44-87 % up to 4 m.
- Not swept: the noise model's shape. The framework's default shape (wander
  0.25, white 0.15, 60 s) has under half the raw shape's error for the same
  accuracy (0.29 against 0.67 of it per axis), which acts like the 2x report
  above: the rule more cautious than it needs to be, never less safe.
