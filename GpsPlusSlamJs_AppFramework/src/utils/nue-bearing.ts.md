# `utils/nue-bearing.ts`

## Purpose

The geographic bearing of a direction in the GPS-world NUE frame (`X = North`,
`Y = Up`, `Z = East`), degrees clockwise from north. Lifted from OsmDemo's
`ar-origin.ts` on 2026-09-24 (DEC-H3) when the AR sun check
(`ar/sun-check-geometry.ts`) needed the same conversion.

## Public API

- `nueBearingDeg(north, east)` → `[0, 360)`, or `undefined` for a
  non-finite or degenerate (vertical, `hypot(north, east) < 1e-6`) direction.

## Invariants & assumptions

- Clockwise from north, like a compass: `(1, 1)` is 45°.
- **Take a camera direction in WORLD space**: the camera is a descendant of
  `arWorldGroup`, which carries the alignment; relative to that group the
  direction is in the AR-odometry frame and is not a geographic bearing.
- A vertical direction has no bearing: `undefined`, never a confident `0`.
- Deep-imported (`gps-plus-slam-app-framework/utils/nue-bearing`), never
  through the `utils` barrel.

## Examples

```ts
const forward = camera.getWorldDirection(new THREE.Vector3());
const bearing = nueBearingDeg(forward.x, forward.z); // undefined when looking straight down
```

## Tests

`nue-bearing.test.ts`: the cardinal directions, the clockwise sense (the
swapped-`atan2` trap), the `[0, 360)` range, and the degenerate cases.
Consumers: OsmDemo's `ar-mode.ts` (the AR HUD's compass) and the sun check's
geometry.
