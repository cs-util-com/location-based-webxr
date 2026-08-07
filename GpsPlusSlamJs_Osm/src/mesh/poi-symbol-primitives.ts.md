# `mesh/poi-symbol-primitives.ts` — the shapes the symbol port needed

## Purpose

Five builders the fifty-model vocabulary never had, added for stage 0c's port of
27 symbol markers from five prototype galleries (DEC-S15).

`poi-primitives.ts` was written for street furniture — boxes, prisms, slabs on
legs, pitched huts. That is the right vocabulary for a bench and it cannot
express a capsule, a cask or a stethoscope. The galleries reach for hemispheres,
tori, solids of revolution, extruded outlines and swept tubes.

## Public API

All take a `MeshBuilder` and append to it, exactly like the sibling file, so a
model composes freely across the two.

- `dome(builder, radius, y, segments?, rings?, up?, offsetX?, offsetZ?)` — a
  capped hemisphere, flat face at `y`.
- `torus(builder, radius, tubeRadius, y, radialSegments?, tubeSegments?, arc?,
offsetX?, offsetZ?)` — lying flat in XZ, hole axis up.
- `lathe(builder, profile, sides?, baseY?, offsetX?, offsetZ?)` — a solid of
  revolution from `[radius, y]` profile points.
- `extrudedPolygon(builder, outline, depth, offsetY?, offsetX?, offsetZ?)` — an
  XY outline given thickness along Z, centred on it.
- `sweptTube(builder, path, radius, sides?)` — a circular tube along a polyline.
- Types: `LatheProfilePoint`, `OutlinePoint`, `PathPoint`.

## Invariants & assumptions

- **Same contract as `poi-primitives.ts`**: ENU in, base and datum decided by the
  caller, every face its own vertices, no degenerate triangles.
- **WINDING IS THE ONE TO GET RIGHT, and reasoning about it did not work.** Three
  separate mechanisms compose here, and the first draft of this file got two of
  them wrong while looking correct:
  - `MeshBuilder.vertex` reflects ENU `+z` north onto render `-z`.
  - `MeshBuilder.triangle(a, b, c)` **already reverses** for that reflection,
    pushing `(a, c, b)`. So an emitter writes the **ENU-correct** order and must
    not compensate for the reflection itself.
  - Whether the ENU-correct order runs with or against a parametrisation depends
    on that parametrisation's handedness. For `torus`, `lathe` and `sweptTube`,
    `cross(du, dv)` points **inward**, so the quads are taken against parameter
    order. For `extrudedPolygon`'s side walls it is against the outline
    direction; for its caps it is `triangulate`'s order as given at the front and
    reversed at the back — **the opposite of the walls in the same function.**
  - **The only reason any of that is trustworthy is the winding suite**, which
    caught all of it. The initial draft had four of five builders inverted, and a
    later draft inverted only `extrudedPolygon`'s two caps — which is invisible
    in a silhouette and shows up as a solid with **one third** of its correct
    volume. **It then caught a regression I introduced myself**, inverting the
    dome cap while extracting a helper to satisfy a complexity warning — which
    is the case for keeping a suite rather than reasoning once and moving on.
- **`dome` is CAPPED where the prototypes' is not.** Theirs is three's
  `SphereGeometry` with a half phi range and no disc across the equator —
  invisible in the galleries because every dome sits on something opaque. Ours
  must survive being a floating symbol with nothing under it (DEC-S4), where an
  open shell is a hole.
- **`torus` lies down where three's stands up.** Every use in the 27 winners is a
  horizontal hoop — a cask band, a fountain rim — so the `rx:90` the sources
  repeat is baked in. Upright callers use `pushTransform`.
- **`lathe` closes itself on the axis** by emitting a fan rather than a collapsed
  quad; a profile that starts and ends on the axis therefore needs no caps.
- **`extrudedPolygon` normalises the outline's winding** before use, so an
  outline typed clockwise produces the same solid rather than an inside-out one.
  Its caps go through the package's ear clipper, not a fan, because these
  outlines are routinely concave — a blade, an arrowhead — and a fan from one
  vertex spills outside a concave shape.
- **`sweptTube` is a POLYLINE where the sources use a Catmull-Rom spline**, and
  that is a stated infidelity. Densely-sampled paths are indistinguishable (the
  stethoscope's arc is 15 points across a semicircle, under a millimetre of chord
  error at symbol scale); sparse ones show corners. **If a ported symbol looks
  kinked, subdivide its path rather than changing this.**
- **`sweptTube` parallel-transports its cross-section** instead of rebuilding it
  from a fixed up-vector, which is the naive version's classic failure: the tube
  spins about its own axis wherever the path turns, showing as a corkscrew in the
  flat shading.

## Examples

```ts
const capsule = composed((b) => {
  dome(b, 0.145, 0.145, 12, 5, false); // lower end, bulging down
  prism(b, 0.145, 0.145, 0.2, 12, 0.145); // red half
  dome(b, 0.142, 0.545, 12, 5); // upper end
});
```

## Tests

`poi-symbol-primitives.test.ts` — 25 examples:

- **The winding suite**, eight cases covering every builder and both outline
  orientations. This is the assertion the previous vocabulary did not have, and
  it is why that one shipped every model inside out for eighteen work items.
- Volume checks against exact figures — half-sphere `2/3 pi`, torus
  `2 pi^2 R r^2`, cylinder via a lathe profile, and a concave arrowhead against
  its shoelace area. A volume is what distinguishes "closed and outward" from
  "looks right", and it is what caught the inverted caps.
- Degeneracy: no zero-area triangle at a dome's pole or a lathe's axis, a lathe
  band with both ends on the axis skipped, a repeated path point survived, and a
  degenerate outline drawing nothing rather than emitting `NaN`.
- Placement: the dome's flat face both ways up, the torus's plane and arc, the
  extrusion centred on Z, and the tube's radius and lack of twist.
