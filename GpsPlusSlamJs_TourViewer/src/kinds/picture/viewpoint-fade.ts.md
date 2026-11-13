# viewpoint-fade.ts

## Purpose

How much of a viewpoint picture shows: proximity times facing. Every view
that shows its picture at a spot (then and now, sharpen, the viewer, the
finder's fill) uses this one mechanism with its own numbers.

## Public API

- `viewpointReach(viewer, facing, viewpoint) -> { distanceM, offAxisDeg }`
  - `viewer` and `facing` in the viewpoint's frame (north, up, east), as the
    world part reads them from the camera.
  - `distanceM` on the ground (height ignored); `offAxisDeg` the heading
    difference, 0 to 180. Pitch is ignored on both sides, unless a direction
    is nearly vertical (its ground part under a tenth of its length), when
    the full angle between the directions stands in.
  - A non-finite input gives `{ distanceM: Infinity, offAxisDeg: 180 }`.
- `viewpointAlpha(reach, fade) -> 0..1`: `smoothstep(ramp)` of the distance
  times `smoothstep(gate)` of the angle. Non-finite reach gives 0.
- `viewpointForward(viewpoint, out?)`: the viewpoint's rotation applied to
  local -Z (the format's camera convention).
- `ViewpointFade { ramp: [far, near], gate: [out, inside] }` and the defaults:
  - `THEN_NOW_FADE` ramp 2.6 to 0.9 m, gate 50 to 30 degrees.
  - `VIEWER_FADE` ramp 3 to 0.8 m, gate 50 to 25 degrees.
  - `SHARPEN_FADE` ramp 7 to 0.5 m, gate 70 to 15 degrees (the default of
    the prototype's sweep of three ramps by three gates).
  - `FINDER_FADE` ramp 0.6 to 0.2 m, gate 30 to 12 degrees.

## Invariants

- The result is always in 0 to 1; 1 at the spot facing the heading; 0 at or
  past the ramp's far end or the gate's out end.
- Never falls as the visitor nears or turns in (monotone), and moves by
  under 0.05 for 1 cm plus 0.1 degree (bounded slope).

## Example

```ts
const reach = viewpointReach(viewerInStation, facingInStation, block.viewpoint);
material.opacity = viewpointAlpha(reach, THEN_NOW_FADE);
```

## Tests

`viewpoint-fade.property.test.ts`: ground distance, heading difference
(symmetric, wrapped), pitch ignored, -Z forward, broken input, range, the
ends, monotonicity and continuity for every default.
