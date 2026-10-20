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
    `undefined` reads as `null` (a plain-JS caller); any other value is a
    caller bug and throws a `RangeError`.
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
  `TELL_APART_FACTOR` (1.5). Each doc comment carries its evidence and
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
  `tooWeak` never guides on nothing. **On `'none'` it is a fail-safe, not
  a verdict on GPS:** a tracking drop or location permission off reads the
  same, so a display or a weak-fix path branches on `source` first - only
  `'gps'` with `tooWeak` means "GPS too weak".
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
  position a code holds (codes-only too); `'none'` with no position (no
  number, too weak); an undefined position as none and an unknown kind
  refused; the
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

A visitor stands at a target whose nearest other targets are S away; "right"
is the share of positions whose nearest target is the visitor's. S is the
distance to the NEAREST other target, and how many targets sit at it depends
on the layout, so the sweep measures three: a **row** (two neighbours at S),
a **square** grid (four at S, four at 1.41 S) and a **hex** grid (six at S),
each at a target with its whole first ring present (in these layouts that
ring alone decides the nearest target, so this equals an inner target of
any larger layout). One seeded error series per cell is read in all three
layouts. GPS: Gauss-Markov error, 1 Hz, 180 s, 40 seeds; true accuracy
1-40 m, spacing 3-50 m (208 cells per layout); the rule reads the reported
accuracy, 0.5x/1x/2x the true one. Noise shapes, mirroring the Tour
Viewer's station sweeps: **raw** (wander 0.6, white 0.3 of the accuracy,
20 s; 0.67 of it per axis: the accuracy read as a 68 % radius, a phone's raw
fix), **mid** (0.45 / 0.2, 20 s), **fused** (0.25 / 0.15, 60 s: the
framework's defaults, an aligned position). The factor is set on raw.
`POSITION_PRECISION_SWEEP_OUT=<file>` writes every cell and summary.

- Honest raw report, ceiling 25 m, 90 % goal (yes / unsafe yes / needless
  no / worst yes; the yes count is the same in every layout, the rule does
  not know the layout):
  - factor 1: 103 yes; row 12 / 0 / 84 %, square 21 / 0 / 73 %, hex
    23 / 0 / 68 %
  - factor 1.25: 89 yes; row 0 / 2 / 92 %, square 7 / 0 / 85 %, hex
    9 / 0 / 82 %
  - **factor 1.5: 79 yes; row 0 / 12 / 97 %, square 0 / 3 / 95 %, hex
    0 / 1 / 93 %** (shipped)
  - factor 1.75: 67 yes; row 0 / 24 / 99 %, square 0 / 15 / 98 %, hex
    0 / 13 / 97 %
  - factor 2: 65 yes; worst yes 98.8-99.3 % across the layouts
- The smallest safe factor per layout and goal (raw, honest report):
  - 80 %: row 1, square 1.25, hex 1.25
  - 90 %: row 1.25, square 1.5, hex 1.5 - the shipped 1.5 is the worst
    layout's
  - 95 %: row 1.5, square 1.75, hex 1.75
- Per noise shape (smallest safe factor in the worst layout, 80 / 90 / 95 %
  goal): raw 1.25 / 1.5 / 1.75; mid 1 / 1.25 / 1.25; fused 0.75 / 0.75 /
  0.75. The shipped 1.5 is safe in every shape and layout; on the smoother
  shapes it only refuses more than it must (needless no's at 1.5, row /
  square / hex: mid 31 / 24 / 18, fused 59 / 50 / 50).
- The report decides it too: a phone reporting half its true error needs 3
  in a grid (2.5 in a row); 1.5 then gives 26 / 35 / 37 unsafe yeses (worst
  73 / 52 / 48 %). One reporting double is safe at 0.75 in every layout.
- Standing anywhere within a quarter of half the spacing of the target
  instead of its centre: 1.5 stays safe (worst yes row 96 %, square 93 %,
  hex 91 %).
- Two other seed sets (seed bases 1 000 003 and 2 000 029) at 80 seeds: the
  same smallest safe factor in every layout; worst yes at 1.5 row 97.0-97.4
  %, square 93.8-95.1 %, hex 92.3-93.4 % (a test re-runs this).
- The ceiling (10-50 m): never an unsafe yes; from 15 m up no verdict
  changes (1.5 already refuses every accuracy above 16.7 m at spacings up to
  50 m); 10 m adds 3 needless no's in every layout.
- A GPS-only museum (3-6 m spacing) is a no at every accuracy above 2 m -
  the case a code exists for.
- A code (`CODE_HELD_ERROR_M` 1 m: yes from 3 m of spacing at 1.5),
  constant error 0-2 m per walk plus jitter 0.05-0.5 m, in all three
  layouts: every yes at least 90 % right up to 1 m of error with 0.25 m of
  jitter. 1 m with 0.5 m of jitter gives 87 % (square) and 83 % (hex) at
  3 m, safe in a row; 1.5 m of error gives 85 % (row, 0.25 m jitter) and
  79 % (hex, 0.05 m jitter) at 3 m; 2 m is unsafe up to 4-5 m.

What would reverse the shipped 1.5:

- The layout: targets only ever in a row would be safe at 1.25.
- The goal: 80 % takes 1.25, 95 % 1.75 (worst layout).
- The report: a phone reporting half its true error needs about 3 (2.5 in a
  row); one reporting double would be safe at 0.75.
- The noise shape: an error smoother than raw at the same reported accuracy
  (mid, fused) is safe from 1.25 and 0.75; an error rougher than raw at
  the same reported accuracy would need more (the half-error report above
  is one such case).
