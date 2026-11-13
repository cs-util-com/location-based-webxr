# ground-route.ts

## Purpose

The pure maths of a short text's `ground` view: the one scale that sizes the
arrow, the route its marks are laid along (bend, 2 m stop, sampling), the
handle circle's radius, the sun warning's contrast, and the hover. No three.js,
no DOM: every promise here is checked by property tests.

## Public API

- `GROUND` - the curves' constants (letter height, length, width and default
  scale against distance), the stop (2 m), the shortest route (0.5 m), the
  sampling step (4 cm), the handle circle (`ringA + ringB * scale`).
- `groundScale(readAtM, distanceM)` - the record's `readAtM` held to the
  format's range; unset, a default from the distance to the point (none:
  `defNoTarget`).
- `groundLetterM(scale)`, `groundLengthM(scale)`, `groundWidthScale(scale)`,
  `GROUND_STYLE_WIDTH` - what the scale gives each style: letter height
  (2-12 m reading curve), arrow length, and each style's width.
- `groundRingM(scale)` / `groundScaleAtRingM(radiusM)` - the editor's size
  circle and its inverse, so a dragged dot stays under the pointer.
- `groundBendDeg(bendDeg)` - the bend held to +-`TOUR_GROUND_MAX_BEND_DEG`
  (a non-number: 0).
- `groundRoute({target, scale, bendDeg?, lenCapM?})` - the route in the
  part's frame (front +Z, Y up): `{none: true, roomM}` when the point is too
  near (room past the stop under 0.5 m), else the direction to the point, the
  start's turned direction `t0`, the length on the straight line, the
  sideways stray `sideM` and the arc-length-sampled path `{pts, L}`. With no
  target it runs straight ahead along +Z at the scale's length, with no stop.
- `routeAt(path, s)` - position, tangent and right vector at arc length `s`
  (clamped to the path).
- `GROUND_DARK_DEFAULT` - each style's dark colour where the record names
  none (the part draws it, the editor's colour well shows it).
- `GROUND_SUN_MIN_RATIO` (3) and `sunContrast(hex)` - a colour's contrast
  ratio against pale sunlit paving; NaN for a string that is no `#rrggbb`.
- `groundFloatM(seed, t)` - a hovering piece's height
  offset at time `t`, within its amplitude (2.5 cm).

## Invariants

- The route starts at the origin and ends on the straight line to the point,
  `lengthM` along it, at least `stopM` short of it; no sample comes nearer
  the point than the stop.
- It leaves turned by exactly the held bend (positive: clockwise seen from
  above, the walker's right, which walking along +Z is -X) and arrives
  pointing at the point; it strays to the side of the bend.
- Samples are ordered by arc length and no more than `sampleM` apart.
- The scale curves are monotonic and bounded; `groundScaleAtRingM` inverts
  `groundRingM` over the format's range and clamps outside it.
- `groundFloatM` depends on its arguments only (deterministic), so a part
  that shows no motion simply does not call it.

## Example

```ts
const scale = groundScale(block.readAtM, Math.hypot(t.x, t.z));
const route = groundRoute({ target: t, scale, bendDeg: block.bendDeg });
if (!route.none) {
  const mid = routeAt(route.path, route.path.L / 2);
}
```

## Tests

`ground-route.property.test.ts` - the route's start, end, stop, bend side,
leaving angle and sampling over random points, scales and bends; the curves'
monotonicity and bounds; the ring round trip; the sun ratio's anchors and its
lower bound; the float's amplitude and determinism.
