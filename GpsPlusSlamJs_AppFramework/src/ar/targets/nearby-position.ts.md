# nearby-position.ts

## Purpose

The position source for [the nearby-targets kernel](nearby-targets.ts.md):
turns the store's GPS event series (device fixes and QR vote samples, each
paired with the AR odometry position at that moment) into the kernel's
`fixes`, `arPoses` and `newestFixAtMs`, trimmed to the look-back H, plus the
live pose.

Deep import only: `gps-plus-slam-app-framework/ar/targets/nearby-position`
(built per-file by `config/tsdown.config.ts`, a knip entry).

## Public API

- `createNearbyPositionSource(options): NearbyPositionSource`
  - `gpsEvents()`: `{ gpsPositions, odometryPositions }` (the store's
    `gpsEvents`; index `i` of one pairs with index `i` of the other), or
    null.
  - `alignment()`: 16 numbers, column-major, odom-NUE to GPS-world NUE, or
    null when the app may not use one; anything not 16 finite numbers reads
    as null.
  - `zero()`: the GPS-world origin, or null.
  - `live()`: the live pose, read on every call.
  - `lookBackMs`: H; `RangeError` unless positive and finite.
  - `position(nowMs)`: `{ fixes, arPoses, newestFixAtMs, live }`;
    `RangeError` on a non-finite `nowMs`.
- `odomNueOfWebXr({x, y, z})`: a WebXR position as odom-NUE
  (`webxrToNUE`), or null when missing or not finite. Every AR position the
  kernel sees goes through it, so one frame holds throughout.
- Types: `NearbyGpsPoint`, `NearbyGpsEvents`, `NearbyPositionSourceOptions`,
  `NearbyPosition`, `NearbyPositionSource`.

## The rule

- `arPoses`: every sample with a finite time and a finite odometry
  position. Its `device` flag is true for a device fix (`gpsPointSourceOf`
  gives `GPS_POINT_SOURCE_DEVICE`); QR votes stay in, flagged not-device.
- `fixes`: device samples only.
  - With an alignment: the odometry through it, judged by the rolling
    device accuracy median (`deviceAccuracySeriesM`, the same window
    `positionPrecision` uses).
  - Without one: the fix's own latitude and longitude relative to `zero`,
    judged by the worse of the median and its own accuracy.
  - A sample without any accuracy yet (no median) is skipped.
- `newestFixAtMs`: the newest device sample with a finite time and
  position, over the whole series (not trimmed), so the kernel can tell a
  fix gap longer than H.

## Invariants and defensive measures

- Memoised on the (gpsEvents, alignment, zero) references: the conversion
  runs once per new series, and each series is read once per build. A call
  costs a binary search plus the window slice, whatever the session length.
  The memo key is set only after a build succeeds, so a build that throws
  is retried on the next call instead of caching the previous result.
- **The H trim** caps `'dr'` at H after the last fix and cuts the AR gate's
  path term for a sighting older than H to the straight step into the
  window (see [nearby-targets.ts.md](nearby-targets.ts.md)).
- External data: a non-array series, a sample with a non-finite time, a
  non-finite odometry position or accuracy never reaches the kernel; an
  unsorted series is sorted (stable) before the search.

## Examples

```ts
const source = createNearbyPositionSource({
  gpsEvents: () => store.getState().gpsData.gpsEvents,
  alignment: () => (alignmentReady() ? alignmentMatrix() : null),
  zero: () => store.getState().gpsData.zero,
  live: () => livePose(),
  lookBackMs: DEFAULT_NEARBY_PARAMS.H,
});
const position = source.position(Date.now());
```

## Tests

- `nearby-position.test.ts`: device-only fixes and `newestFixAtMs`, aligned
  and lone fixes with their accuracies, one rebuild per reference (a getter
  spy; a new zero alone rebuilds the lone-fix path; a build that threw is
  retried), only the window's samples on a 3 600-fix series, a fix gap longer
  than H reading `'unknown'` (and `'dr'` just inside H), a sighting older
  than H with its path cut, non-finite and unsorted input, the live pose
  per call, `odomNueOfWebXr`.
- `nearby-position.property.test.ts`: for any arrival order, the windowed
  samples are handed over sorted and `newestFixAtMs` is the newest device
  time; when every device sample has a finite accuracy, every device fix in
  the window is handed over.
- See also the gate that consumes it,
  [tracker-capture-gate.ts.md](tracker-capture-gate.ts.md).
