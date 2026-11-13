# `editor/picture-viewpoint.ts` - a picture's viewpoint, as the editor makes and types it

## Purpose

The pure part of the editor's viewpoint: the first viewpoint a picture
gets when it is switched to a view seen from one (`thenNow`, `sharpen`,
`viewer`, `finder`, `window`), what the inspector shows of a viewpoint,
and one typed field written into it. The frame is the station's: x north,
y up, z east; the camera looks along its local -Z, up its local +Y (the
same reading as `kinds/picture/viewpoint-fade.ts`'s `viewpointForward`).

## Public API

- `VIEWPOINT_STAND_BACK_M` (6), `VIEWPOINT_EYE_M` (1.6),
  `VIEWPOINT_LENS_DEG` (56); the pitch is held within 80 degrees (internal).
- `VIEWPOINT_FIELDS`: the typed fields in the inspector's order, each
  `{ field, label, unit }`: `vp-north`, `vp-up` (Eye height), `vp-east`,
  `vp-facing`, `vp-pitch`, `vp-lens`, `vp-distance` (Depth).
- `viewpointRotation(facingDeg, pitchDeg)`: the quaternion that faces a
  heading (clockwise from north) and looks up by a pitch.
- `viewpointFacts(vp) -> ViewpointFacts`: north, up, east, facing
  (0 to 360), pitch, lens, depth.
- `mintViewpoint(pose)`: a first viewpoint for a picture at `pose` (station
  frame): `VIEWPOINT_STAND_BACK_M` in front of its front (local +Z) on the
  ground, at eye height, facing it level, lens 56, depth the way back, so
  the picture seen from it hangs where it stood.
- `viewpointWithField(vp, field, value)`: `vp` with one field typed, or
  null for an unknown field or a value that is no finite number.

## Invariants and assumptions

- Facing and pitch read back what `viewpointRotation` was given (pitch
  within +-80); a straight-up or straight-down camera reads facing 0.
- A picture lying flat (front up or down) has no front on the ground: it
  is stood in front of from the south, facing north.
- A non-finite pose never gives a NaN viewpoint (the place falls back to 0).
- Bounds: lens 10 to 120 and depth 1 to 500 (the format's
  `TOUR_PICTURE_*` constants), pitch +-80; a typed value past one is kept
  at it, never refused.
- Typing the facing keeps the pitch and the other way round.

## Examples

```ts
const vp = mintViewpoint({ position: [0, 1.2, 0], rotation: [0, 0, 0, 1] });
viewpointFacts(vp); // stands 6 m east, facing 270 (west), level
viewpointWithField(vp, "vp-lens", 40); // the same with a 40 degree lens
```

## Tests

`picture-viewpoint.test.ts` (round trip of facing and pitch as a property,
agreement with the viewer's `viewpointForward`, the mint as a property,
the flat and NaN cases, every field, the bounds, the null cases).
