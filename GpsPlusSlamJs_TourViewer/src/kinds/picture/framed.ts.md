# `kinds/picture/framed.ts` - a framed print's look

## Purpose

Builds the `framed` view's look from the chosen picture prototype's
numbers: a dark bevelled frame (extruded with a hole), a dark back, a
painted cream mat, the print, and under the frame a plate with the year,
three lines of the caption and the credit (`picture-paint.ts`, words cut
by `plate.ts`).

## Public API

- `PICTURE_REFERENCE_WIDTH_M = 1.6` - the print width the look is built
  at; the caller scales the root by `widthM / 1.6`.
- `framedSizes(widthM, aspect)` - print, mat, frame, inner and outer sizes
  (m): mat `max(0.05, 0.07 w)`, frame `clamp(0.034 w, 0.03, 0.12)`.
- `buildFramedLook(picture, aspect, words, painters) -> { root, tapTarget,
floor, ground, level, arrive }`
  - origin at the print's centre, facing local +Z; the plate hangs 5 cm
    under the frame's foot.
  - `ground(liftM)` - lays the shadow (`picture-framed-shadow`) `liftM`
    below the print's centre plus `FRAMED_SHADOW_LIFT_M` (12 mm), in the
    floor's parent's metres (the floor's scale is undone). It is the
    prototype's `shadowDecal(ow * 1.2, 0.9, 0.2)`: 1.2 x the frame's outer
    width, 0.9 m deep at the reference width, opacity
    `FRAMED_SHADOW_OPACITY` 0.2, the painters' radial shadow, no depth
    write, no ray. It hangs in `floor` (`picture-framed-floor`), apart
    from the root, which the caller hangs beside the part's tap target
    with the root's place and scale, so no bounds of the tap target (a
    pick's fallback box, the editor's outline) reach the ground. A value
    that is no finite number changes nothing.
  - `level(partRotation)` - turns the floor by the inverse of the part's
    rotation times its turn about the vertical (`uprightTurn`), so under a
    pitched or rolled part the shadow lies flat on the ground with only the
    part's heading. Worked out only when the rotation changes (the last
    one is kept), since `uprightTurn` allocates.
  - `arrive(a)` - arrival `a` (0..1): the frame, print and plate stand
    `framedRise(a)` below their place and the picture is
    `framedDevelop(a)` out of the paper. A new look stands arrived.
- `FRAMED_ARRIVAL_S = 1.6`, `FRAMED_RISE_M = 0.12` - the prototype's
  appear rate (`dt / 1.6`) and rise.
- `framedRise(a) = -0.12 (1 - smoothstep(0, 0.7, a))`, `framedDevelop(a) =
smoothstep(0.3, 1, a)`: it comes up first, then develops. NaN: arrived.

## Invariants and assumptions

- Scaled as one object: the mat, frame and plate text grow with the
  print. The prototype kept them at fixed sizes beyond about 0.9 to 3.5 m;
  uniform scale is what the placement contract asks (a size extent
  doubles the drawing), and at 1.6 m the two are identical.
- The rise is 12 cm at the reference width and scales with the print,
  like the rest of the look (a 0.8 m print rises 6 cm).
- The develop is the prototype's shader, injected into three's basic
  shader after `map_fragment` through `onBeforeCompile` (the paper colour
  `(0.84, 0.77, 0.62)` gives way to the picture's darks first); its
  uniform is one object, so a frame's write needs no recompile, and its
  program cache key keeps it apart from plain basic materials. It stays a
  `MeshBasicMaterial`, so the station's fade still writes its opacity.
- The arrival writes no opacity: the station's own content fade
  (`content-fade.ts`, 0.4 s) fades the look and its shadow in, where the
  prototype faded them over the first 45 % of its arrival. Writing it here
  too would fight the fade's remembered own opacities.
- No per-frame allocation: `ground` and `arrive` write numbers only,
  and `level` returns at once for an unchanged rotation.

## Tests

`world.test.ts` (parts, layout, scale, the ground shadow, out of the tap
target's bounds and level under a pitched or rolled part, the arrival in
play and its absence in the editor, `framedRise` / `framedDevelop`) and
the placement contract test.
