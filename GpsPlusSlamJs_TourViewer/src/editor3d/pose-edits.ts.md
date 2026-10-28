# pose-edits.ts

## Purpose

The 3D view's edits of a tour geo pose, pure: where it faces, a turn about
up, a move keeping its height above the ground, a nudge by metres east and
north, and a lift. Poses and grounds are the tour's: latitude, longitude,
an ELLIPSOIDAL altitude, and a heading or a rotation in the north-up-east
frame.

## Public API

- `headingOfGeo(geo)`: degrees clockwise from north in [0, 360): a
  heading-only pose's heading; a rotation's bearing of its x axis (the
  format's heading, `deriveVerticalHeading`'s convention); 0 when that axis
  is vertical.
- `turnedGeo(geo, deg)`: turned `deg` clockwise seen from above. A
  heading-only pose stays heading-only; a rotation is premultiplied by the
  turn about up and keeps the heading the format derives beside it (none
  for a tilted pose). RangeError for a turn that is not finite.
- `placedGeo(geo, place, groundBeforeM, groundAfterM)`: at `place`,
  keeping its height above the ground (`altKeepingHeight`). RangeError for
  anything not finite.
- `nudgedGeo(geo, eastM, northM, groundAt)`: moved by `offsetGeo` (the
  stack's own geodesy), keeping its height above the ground; where either
  ground is unknown (`groundAt` null: not loaded yet) the altitude is kept.
- `liftedGeo(geo, m)`: `m` up (down when negative).
- Types `Place`, `GroundAt`.

## Invariants & assumptions

- The height rule (the editor's): a moved item keeps its height above the
  ground under it, unless the creator lifts it.
- n nudges then n back return within 1 mm; 360 degrees in 5-degree steps
  return the heading (the property tests' sweep, below).
- The geodesy is licence-gated: the page's store activates it, and tests
  create a store first.

## Examples

```ts
nudgedGeo(geo, 0.1, 0, groundEllipsoidalAt); // 0.1 m east, same height over the ground
turnedGeo({ ...geo, headingDeg: 350 }, 15).headingDeg; // 5
```

## Tests

`pose-edits.test.ts`: the headings of heading-only, upright and vertical
poses; a turn keeps the pose's shape; a placement and a nudge keep the
height over tilted ground, measured with the stack's own ruler
(`calcRelativeCoordsInMeters`); the altitude kept where the ground is
unknown; refusals. `pose-edits.property.test.ts`: n nudges and n back
within 1 mm (steps 0.1 and 1 m; ground amplitude 0, 10, 100 m; n 1-200;
latitude -80..80); a full turn in 1, 5 and 15-degree steps returns the
heading within 1e-6 degrees and the rotation within 1e-9, for heading-only,
upright and tilted poses.
