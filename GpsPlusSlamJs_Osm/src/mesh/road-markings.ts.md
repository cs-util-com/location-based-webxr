# `src/mesh/road-markings.ts`

## Purpose

Zebra crossings from the map (city objects plan
`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`,
M4b; the O3 lab's look, chosen by the owner). Stripes run along every
zebra-marked crossing way, and across the road under every zebra-marked
crossing node that no striped way passes through. Nothing is invented: a
crossing the map does not call a zebra gets no paint, and a node on no car
road is skipped rather than given a guessed direction.

## Public API

- `ZEBRA_PARAMS` - frozen `{ pitchM: 1, barM: 0.5, lengthM: 3, snapM: 0.05 }`:
  one stripe plus one gap, a stripe's width along the walk, its length across
  the walk when the way has no `width` tag, and how close a node must lie to a
  vertex to sit on it.
- `isZebraTags(tags) -> boolean` - `crossing:markings` is `zebra`, `ladder`,
  `zebra:double` or `ladder:skewed`, or `crossing=zebra`, or
  `crossing_ref=zebra`. `undefined` tags read as false.
- `ZebraStripe` - `{ cx, cy, ux, uy, widthM, lengthM }`: centre (ENU metres),
  unit direction ACROSS the walk, the two sizes.
- `ZebraCrossing` - `{ feature, stripes }`.
- `zebraCrossings(features, frame, { pitchM? }) -> ZebraCrossing[]` - ways
  first (input order), then nodes. `RangeError` for a pitch that is not finite
  or not above `barM` (the stripes would touch).
- `BuildRoadMarkingsOptions` - `{ frame, groundHeightM?, liftM?, pitchM? }`;
  `liftM` defaults to `roadMarkingLiftM()` and must be finite, else
  `RangeError`.
- `RoadMarking` - `{ feature, stripeCount, mesh }`.
- `buildRoadMarkings(features, options) -> RoadMarking[]` - two up-facing
  triangles per stripe, draped per corner on the ground (a ground that is not
  a number reads as 0), one mesh per crossing.
- None of these is on the package entry: `buildCity`'s
  `roads: { markings }` is the consumer's switch, as for the road ranks.

## Invariants & assumptions

- **Which ways are striped:** `isRoad`, rank 0 (a path), a crossing
  (`footway=crossing` or any `crossing` tag) and zebra-tagged. A car road
  tagged zebra is NEVER striped along its length (a deviation from O3, which
  would paint the whole street): the tag belongs to its crossing.
- **Lone nodes:** a zebra node within `snapM` of a striped way's vertex is the
  same crossing and is skipped. Otherwise the first car road in input order
  with a vertex there carries it; the stripes run across that road, as long as
  the road is wide (`roadWidthM`), using the neighbouring vertices for the
  road's direction. A node on no car road vertex draws nothing.
- Points are hashed into `snapM` cells (`PointIndex`), and `near()` returns
  the earliest-added match, so the outcome does not depend on hash order.
- Stripe count along a straight crossing of length `L` is `floor(L / pitch)`
  give or take one; stripes stay `barM / 2` inside the ends.
- Lift: `roadMarkingLiftM()` = the top rank's lift plus 5 mm clearance
  (0.025 m with the default 5 mm step), so paint covers every road class.

## Examples

```ts
const marks = buildRoadMarkings(features, { frame, groundHeightM });
const stripes = marks.reduce((n, m) => n + m.stripeCount, 0);
```

## Measured on the O3 scenes (2026-11-11)

- Park Slope: 1,089 stripes, O3's own number. Pitch 0.8 / 1 / 1.2 m gives
  1,375 / 1,089 / 904.
- Meggen: 111 stripes (139 / 111 / 91 by pitch) against O3's 109. The two
  extra crossings are lone island nodes (`crossing:island=yes`,
  node/1191425770 and node/1614907627) that draw 6 stripes each here; the
  difference is unexplained. O3 picks the carrying road lowest rank first,
  this module in input order: tried 2026-11-11, the rank order still gives
  111, so the input order stayed.
- Heidelberg: one crossing, a node, 6 stripes (7 / 6 / 5 by pitch).

## Tests

- `road-markings.test.ts` - the zebra predicate, ways and nodes, the
  way-and-node dedup, the car-road guard, the `width` tag, ground draping and
  lift, face winding, the option refusals. (Written before the module, but the
  red run was not observed.)
- `road-markings.property.test.ts` - stripes on their straight crossing, a
  whole pitch apart, as many as fit, at pitches 0.6-2 m; a way-and-node
  crossing painted once in any input order.
- `testdata/sites/site-roads.test.ts` - the scene counts above, pinned.
