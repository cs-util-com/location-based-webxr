# device-gps-quality.ts

## Purpose

The phone's own GPS fixes in a stored GPS history, and their quality: the
ONE device-only filter (`deviceSamples`) and the ONE accuracy median
(`medianAccuracyM`) the Tour Viewer reads them by. A scanned code's votes
share the store's GPS history (sixteen synthetic points per voted lock, each
claiming the votes' fixed accuracy), so a count or a median over every
stored point would read a code seen indoors as a well-aligned GPS session.

Read through here:

- the visitor's GPS line and the "Continue with GPS only" escape
  (`ar-entry.ts` `sessionGpsQuality`, `viewer-placement.ts`
  `entryHasDeviceFix`) - `deviceGpsQuality`;
- the creator's placement gate, its status line and the quality a newly
  measured code is stamped with (`creator-setup.ts` `authorAlignmentInfo`,
  read by `mintQrLevel`) - `deviceGpsQuality`;
- the creator's visit log (`visit-log.ts`: its walk and its
  `gpsAccuracyM`) - `deviceSamples` and `medianAccuracyM`;
- the walked distance (`walked-distance-tracker.ts`) and the moved-code
  estimators (`code-displacement.ts`) - `deviceSamples`.

One filter and one median, so a code's mint stamp and its visit's log entry
read the same accuracy for the same visit.

Not yet folded in: `visitor-position.ts` and `tour-relocation.ts` read the
library's source predicate directly, because they need a fix's altitude and
the latest or first fix rather than a count or a median. Folding them is a
follow-up.

## Public API

- `deviceSamples({ gpsPositions, odometryPositions }): DeviceSample[]`
  - The device fixes (`gpsPointSourceOf(p) === GPS_POINT_SOURCE_DEVICE`; a
    point without a source stamp is the phone's, by the library's rule)
    with readable coordinates, each with its odometry partner (index for
    index; `null` when the lists are not paired or the partner is not three
    finite numbers) and its own `timestampMs` when finite.
  - Synthetic votes are left out: a vote's odometry is the code's corner,
    not where the phone stood.
- `medianAccuracyM(fixes: readonly DeviceGpsPoint[]): number | null`
  - The interpolating median (the mean of the two middle values for an even
    count) of the fixes that report an accuracy; `null` when none does.
  - Why this rule: the standard statistic, not biased by the count's
    parity, and the one the visit combiner's accuracies were always read
    with. It replaced the upper-middle element (`sorted[length >> 1]`) the
    count-and-median used to take: for an even count the visitor's line and
    a code's mint stamp now read up to half the gap between the two middle
    accuracies lower than before.
- `deviceGpsQuality(positions): DeviceGpsQuality` = `{ fixes, accuracyM }`,
  built on `deviceSamples` (no odometry) and `medianAccuracyM`.
- `readGpsPoint(lat, lng, accuracy): DeviceGpsPoint | null` - the one
  readability check: finite coordinates in range; the accuracy kept only
  when it is a positive finite number.
- Types: `DeviceGpsPoint { lat, lng, accuracy? }`, `StoredGpsFix` (the
  stored point as external data: every field `unknown` but `source`),
  `DeviceSampleInput`, `DeviceSample { fix, odom, timestampMs? }`,
  `DeviceGpsQuality { fixes, accuracyM }`.

## Invariants & assumptions

- Pure: no store access, no clock; the caller passes the history it means
  (a creator passes the slice since its AR session started).
- Defensive about external data: an unreadable point (non-finite or
  out-of-range coordinates) is no fix and is not counted; a missing,
  non-finite, zero or negative accuracy states nothing about the fix's
  error and is left out of the median, while the fix still counts.
- Synthetic points of any source (a code's votes today) never change any
  result, wherever they sit in the history.

## Examples

```ts
const quality = deviceGpsQuality(selectGpsPositions(store.getState()));
if (quality.fixes === 0) {
  // indoors: only a code's votes, or nothing
}
const walk = deviceSamples({
  gpsPositions: selectGpsPositions(state),
  odometryPositions: selectOdometryPositions(state),
});
```

## Tests

- `device-gps-quality.test.ts`: the count and the median (the interpolating
  rule for an even count), votes left out, unstamped points counted,
  unreadable points not counted, unusable accuracies left out of the median.
- `device-gps-quality.property.test.ts`: whatever votes are mixed in, the
  result equals that of the device fixes alone.
- `visit-log.test.ts` `deviceSamples`: the odometry pairing and timestamps.
- Composed: `creator-code-votes.test.ts` (a vote-only visit mints nothing
  and its quality counts no votes) and `ar-entry.test.ts` (the visitor's
  GPS line).
