# globe-cloud-drift.ts

## Purpose

The clouds' drift by the camera's altitude (round-5 plan
`GpsPlusSlamJs_Docs/docs/2026-10-12-0612-globe-round-5-cloud-morph-owner-feedback-plan.md`
§9, DEC-R5-3). The owner on r826: one drift rate felt too slow while the
whole Earth was in view and far too fast near the volumetric clouds. Seen
straight down from the altitude h, a ground speed v moves on the screen at
v / h radians a second, so a single rate looks 4,000 times faster at 10 km
than at 40,000 km (r826: about 0.01 degrees a second on the screen far out,
60 at 10 km).

## Public API

- `GLOBE_CLOUD_DRIFT_LAW`: `farM` 20,000 km (the far rate from here up),
  `windMps` 10 (the slowest drift over the ground, at the equator: a calm
  wind, reached at about 5 km), `radiusM` 6,371 km (degrees to metres),
  `maxStepS` 1 (one summed step at most: a stalled frame or a hidden tab
  resumes about where it stopped; above the slowest headless frames, about
  0.7 s, so it never slows a running drift).
- `cloudDriftDegPerS(altitudeM, { farDegPerS?, farM?, windMps? })`: degrees
  of longitude a second. `farDegPerS` (default
  `GLOBE_CLOUD_DRIFT_DEG_PER_S`, 0.375) from `farM` up; below it
  proportional to the altitude, so the apparent speed straight down holds at
  about 0.12 degrees a second; never slower than `windMps` over the ground,
  never faster than the far rate. A far rate of 0 stills the clouds
  everywhere. An altitude that is not a number reads as far out, a negative
  one as the ground. RangeError for a far rate or wind below 0 or a `farM`
  that is not positive (each finite).
- `advanceCloudLonOffsetRad(offsetRad, dtS, degPerS)`: the offset moved
  east by `degPerS` over `dtS` seconds, wrapped into [0, 2π); a step capped
  at `maxStepS`; a step that is not forward or not a number moves nothing.
  RangeError for an offset or a rate that is not finite.

## Invariants and assumptions

- The surface, the shell and the slab read one offset (`uCloudLonOffset`);
  with a rate that changes with the altitude it is SUMMED per frame. Rate x
  time (`cloudLonOffsetRad`) would jump the clouds at every change of
  height; it only seeds the sum (the lab's first frame, a new clock, a new
  far rate), so a link's clouds start where they always did.
- At a steady rate the sum equals rate x time to 1e-6 rad (property test).
- The rate never falls as the camera climbs (property test); the law is
  proportional on purpose: an exponent below 1 would make the clouds faster
  on the screen the lower the camera, above 1 slower.

## Examples

```ts
const rate = cloudDriftDegPerS(altitudeM, { farDegPerS: 0.375 });
offset = advanceCloudLonOffsetRad(offset, frameS, rate);
```

## Tests

- `globe-cloud-drift.test.ts`: the far rate from `farM` up (the flight's
  start included), the apparent speed held from 10 km to `farM` (against
  r826's 4,000x), the wind floor, monotone in the altitude, the knobs and
  refusals; the sum (adds and wraps, the step cap, matches rate x time at a
  steady rate frame by frame, refusals).
- The page: `GpsPlusSlamJs_DesignSystem/labs/globe/globe-sky.smoke.spec.mjs`
  ("the clouds drift slower the nearer the camera is to the ground": the
  rate at 30,000 and 50 km, and the uniform's measured speed at 50 km).
