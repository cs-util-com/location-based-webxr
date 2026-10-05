# globe-sky-hand-over.ts

## Purpose

The arithmetic of the sky hand-over on the descent from space to the ground
(globe F2 plan `2026-10-03-1922-globe-f2-frame-and-atmosphere-hand-over-plan.md`,
F2b): the space halo's thickness on the way down, the ground sky's
cross-fade weight, the ground sky's observer height in rebuild steps, the
exposure eased between the two skies, and the sun's rebuild step. Pure
functions with no imports beyond `globe-ease.ts`, so the globe lab and the
tests read the same numbers.

## Public API

- `GLOBE_SKY_HAND_OVER`: the defaults.
  - `shellFromKm` 2,000 and `shellToKm` 300: the halo's ramp.
  - `edgeKm` 80 and `widthKm` 20: the ground sky's edge and cross-fade.
  - `observerCeilingKm` 99.9 (the framework's atmosphere is 100 km thick
    and refuses its top) and `observerFloorKm` 0.01.
  - `altitudeStepPct` 5 and `sunStepDeg` 0.25: the rebuild steps.
- `shellThicknessAt(altitudeKm, thickness, { fromKm?, toKm? })`: the far
  `thickness` at and above `fromKm`, 1 at and below `toKm`, smoothstep in
  log altitude between (DEC-GL5-13). RangeError for a non-finite altitude,
  a thickness below 1, or edges not `0 < toKm < fromKm`.
- `groundSkyWeight(altitudeKm, { edgeKm?, widthKm? })`: 0 at and above the
  edge, 1 at and below `edgeKm - widthKm`, smoothstep between. RangeError
  for a non-finite altitude, an edge outside (0, 100) km, or a width not in
  (0, edgeKm].
- `quantisedObserverKm(altitudeKm, stepPct?)`: the nearest power of
  `1 + stepPct / 100`, at most the ceiling, 0 below the floor (and for a
  height that rounds below it). Idempotent. RangeError for a negative or
  non-finite altitude or a step that is not positive.
- `easedExposure(spaceExposure, groundExposure, weight)`: linear in the
  exposure's logarithm, the weight clamped into [0, 1] (DEC-GL5-16).
  RangeError for an exposure that is not positive and finite, or a
  non-finite weight.
- `sunStepped(previous | null, next, stepDeg?)`: whether the sun moved by
  at least the step (true for a first sun). RangeError for a zero or
  non-finite direction or a step that is not positive.

## Invariants & assumptions

- Continuity is the point: every curve is a smoothstep or a log-linear
  ease, so the frame has no pop at an edge. The weight's slope is at most
  1.5 / width per km (a property test).
- The observer steps bound the ground sky's rebuilds: over a descent from
  100 km to 1 km about 48, 94 or 233 at 10, 5 or 2 % (the plan's frame
  budget was sized with these counts; a test pins them).
- The ceiling keeps the observer inside the framework's atmosphere
  (`SkyAtmosphere.setObserverAltitudeKm` refuses 100 km and above).

## Examples

```ts
const w = groundSkyWeight(altitudeKm); // 0 above 80 km, 1 below 60 km
atmosphere.setLook({ thickness: shellThicknessAt(altitudeKm, 6) });
const km = quantisedObserverKm(altitudeKm);
if (km !== groundSky.observerAltitudeKm) groundSky.setObserverAltitudeKm(km);
const exposure = easedExposure(spaceExposure, groundSky.exposure, w);
```

## Tests

`globe-sky-hand-over.test.ts`: the endpoints and the geometric middle of
the ramp, the monotony and slope bound of the weight, the quantisation's
idempotence and half-step bound (fast-check; it found the floor's rounding
case), the rebuild counts per step, the exposure's equal EV steps, the sun
step, and every refusal.
