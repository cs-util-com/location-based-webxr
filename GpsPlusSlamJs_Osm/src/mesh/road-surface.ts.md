# road-surface.ts

## Purpose

The ground a road actually draws on, at any point in plan, so what lies on a
road (zebra paint) or under it (a pedestrian square) can follow the road
rather than the raw ground.

A ribbon (`roads.ts`) samples the ground only at its own vertices and is a
straight chord between them. On curved ground that chord parts from the
ground under its middle, and paint or squares that sampled the ground at
their own points ended up metres under the road or over it. Measured on the
corpus with a sine ground (wavelength 60-300 m, amplitude 2-20 m): paint up
to 0.77 m under the road surface (Park Slope), squares up to 1.8 m over a
road crossing them (Heidelberg), against clearances of 5-8 mm. With the
index: no paint corner under a road and no square vertex over one, on
Meggen, Park Slope and Heidelberg across that whole range.

## Public API

- `roadGroundIndex(ribbons: readonly RoadRibbon[]): RoadGround`
  - `RoadGround.highestAt(p: EnuPoint): number | undefined` - the highest
    ground of the ribbons covering `p` (ENU metres east, north), for paint.
  - `RoadGround.lowestAt(p: EnuPoint): number | undefined` - the lowest, for
    squares.
  - Both return `undefined` off every road; the caller then takes the
    ground.
- "Ground" here is the ribbon's mesh height at `p` minus the ribbon's own
  `liftM`, so the caller adds its own lift and the layer order (squares,
  paths, roads by rank, paint) holds as on flat ground.

## Invariants and assumptions

- Ribbons as `buildRoads` returns them: mesh x east, y up, z minus north.
- A ribbon whose `liftM` is not finite, and any triangle with a non-finite
  coordinate, is skipped: one bad way cannot poison its neighbours.
- A 16 m grid of triangle bounding boxes; a lookup tests only its cell's
  triangles. Degenerate (zero-area) triangles never answer.
- A barycentric slack of 1e-6 counts a point on a shared edge in both
  triangles and a vertex the float32 mesh rounds just outside.
- Only VERTICES follow the road. A stripe or an area triangle that spans a
  crease of the ribbon (where two of its triangles meet at an angle) is
  still a straight face across it; at stripe sizes (0.5 m) this is far below
  the clearance, and it is not measured.
- Paint past the kerb (a crossing longer than its road is wide) is off every
  ribbon and lies on the ground, as the pavement does.

## Examples

```ts
const ribbons = buildRoads(features, { frame, groundHeightM });
const index = roadGroundIndex(ribbons);
const paintGround = (ll: LatLng) =>
  index.highestAt(frame.toEnu(ll)) ?? groundHeightM(ll);
buildRoadMarkings(features, { frame, groundHeightM: paintGround });
```

`city.ts` (`roadsGround`) is the one caller; it skips the index on flat
ground.

## Tests

- `road-surface.test.ts`: the lift taken off and nothing answered off the
  road or on the wrong side of it (a z sign error), the highest and lowest of
  two crossing chords, a non-finite lift skipped, and a property: over a
  plane ground every chord is exact, so any point on a way's centre line
  answers the plane (any shape, any class).
- `city.test.ts` "markings and squares on curved ground follow the road
  surface": a two-vertex road over a parabola, the paint above the road and
  a square under it (both red before the index was wired in).
