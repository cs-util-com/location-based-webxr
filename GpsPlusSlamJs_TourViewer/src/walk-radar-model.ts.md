# walk-radar-model.ts

## Purpose

The visitor's radar as data (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M3, §1.2, §1.3, §5): heading-up and centred on the visitor, a square-root
distance scale, the scale rings, north, the view cone, a blip per station
in the list's glyph language, the arc on the rim for a focus outside the
view, and the visitor's own mark by precision. Pure; `walk-radar.ts`
draws it on a canvas. Also the precision chip's words, the camera's field
of view and the adaptive range.

## Public API

- `WALK_RADAR_RANGE_M = 300` - W4's fixed range, the start before any
  distance is known (the radar ships the adaptive range, below).
- `WALK_RADAR_FALLBACK_VFOV_DEG = { portrait: 64, landscape: 44 }`
  (module-local) - W4's camera's VERTICAL field of view (three.js `fov`), 64° on a screen
  taller than wide, 44° otherwise.
- `WALK_BLIP_PX = { focus: 8.5, other: 6.5, later: 3.5 }` (module-local).
- `walkPrecisionChip(kind, accuracyM) => string` - "Placed by a code",
  "GPS - about N m", "GPS - about N m, too weak", "Position unknown",
  "Finding your position…", "Paused - tracking lost"; a missing or
  invalid accuracy is left out ("GPS", "GPS - too weak"), never invented.
- `walkRadarFovDeg(projection0, aspect) => number` - `2 atan(1/P[0])`
  in degrees; for a missing, non-finite or non-positive value, W4's
  camera at the screen's aspect (width / height),
  `2 atan(tan(v/2) * aspect)`: about 32° on a portrait phone (390 x 844), 82° sideways
  (844 x 390), 66° on a 1440 x 900 desktop; an aspect that is no
  positive finite number reads as square (44°). A `fovDeg` the model is
  handed that is no angle falls back to that square 44°.
- `walkRadarRings(rangeM) => { m, label }[]` - two round rings near a
  twelfth and a third of the range (W4's 25 m and 100 m at 300 m); the
  outer one labelled.
- `WALK_RADAR_ADAPTIVE: WalkRadarAdaptiveRule = { k: 3, factor: 1.2,
minM: 30, maxM: 600, shrinkBelow: 0.65 }` (module-local; the default
  of `walkRadarAdaptiveRangeM`'s `options`).
- `walkRadarAdaptiveRangeM(unfoundDistancesM, previousM, options?)` - the
  k-th nearest station still to find, times the factor, clamped and
  rounded up to a step of 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a
  power of ten. It grows at once and shrinks only below 65 % of the
  shown range; with no distance it keeps the shown range (else 300 m).
- `walkRadarModel(input: WalkRadarInput) => WalkRadarModel`
  - input: `stations` (id, number, the list's row state), `order`, `kind`
    (the chip's kind: pending, code, gps, weak, none, lost), `accuracyM`,
    `live` and `snapshot` geometries (bearings, distances, heading),
    `fovDeg`, `sizePx`, optional `rangeM`;
  - output: `mode` (live, frozen, pending), `rangeM`, `centre`, `rimR`,
    `rings`, `north` (radians clockwise from up, null without a heading),
    `cone` (half width, radians), `visitor` (pin, blur with tone and
    radius, unknown, pending), `blips` (id, number, look, x, y, r, alpha,
    clamped), `distanceRings` (no heading: how far, not which way),
    `rimArc` (the focus's angle when outside the view);
  - throws `RangeError` for a size too small for a rim or a non-positive
    range; an invalid field of view falls back to 44° (W4's camera on a
    square screen).

## Invariants & assumptions

- Frozen (`none`, `lost`) reads the SNAPSHOT geometry only, never the
  live one; the stations' states are always live (a skip in the list
  shows at once). Frozen has no focus, no rim arc and the "?" mark.
- Frozen draws the cone and north from the snapshot's heading (the plan's
  "the last geometry"); W4's prototype drew no cone frozen.
- No heading: no blips, no cone, no north; dashed rings for the stations
  still to find (found and skipped left out).
- `pending` draws no stations at all (W4's searching rings).
- A blip's angle is `bearingDeltaDeg(bearing, heading)`; its radius
  `R * sqrt(min(d, range) / range)`, clamped to `R - 8`.
- Weak fades every blip to 0.5 (W4's prototype; the plan says "nearby").
- No station is labelled with a distance: the rings carry the scale, the
  list the distances (§1.2).
- At most one focus; none in an any-order tour while no distance is shown
  and two or more stations are still to find (§1.9 R-2).

## Examples

```ts
const model = walkRadarModel({
  stations: [{ id: "well", number: 2, state: "next" }],
  order: "any",
  kind: "gps",
  accuracyM: 6,
  live: { bearings, distances, headingDeg: 10 },
  snapshot: null,
  fovDeg: walkRadarFovDeg(p0, innerWidth / innerHeight),
  sizePx: 132,
  rangeM: walkRadarAdaptiveRangeM([46, 120], previous),
});
walkPrecisionChip("weak", 42); // "GPS - about 42 m, too weak"
```

## Tests

- `walk-radar-model.test.ts` - the chip's words, the field of view, the
  rings, blip geometry and clamp, the cone, the looks, the rim arc, each
  precision mark, frozen from the snapshot and without one, pending, no
  heading, the guards, the adaptive range.
- `walk-radar-model.property.test.ts` - a blip's angle is the bearing's
  delta; its radius grows with distance and stays inside the rim for
  96-144 px; at most one focus, none under the any-order no-distance
  rule; the blur grows with accuracy and is at least 7 px; a frozen model
  is the same for two different live geometries.
- `walk-radar-model.sweep.test.ts` (~20-40 s) - the overlap sweep, table to
  `WALK_RADAR_SWEEP_OUT`.

## The overlap sweep's verdict (2026-10-21)

- Parameters: tours "town" (stations 25-50 m apart, turns up to 60°, 4,
  12, 30 and 100 stations) and "museum" (3-6 m apart, turns up to 120°,
  4, 12, 30), eight seeds, five samples per leg, the nearest unfound the
  focus; rules fixed 150 / 300 / 600 m and adaptive k 3-6 x 1.2 / 1.35 /
  1.5, each with the production hysteresis; sizes 96-144 px; extra runs
  with blips at 0.5 and 0.75 scale and a 10 m floor.
- Pass bar (per tour, at 132 and 108 px): the focus clear in at least 95 %
  of positions AND at most 10 % of the unfound blips overlapping.
- Result: NO rule passes for every tour. Mean over tours and the two
  shipped sizes, focus overlapped / unfound overlapping: fixed 300 m
  81.8 % / 94.3 %, fixed 150 m 57.5 % / 85.3 %, fixed 600 m 93.7 % /
  97.6 %, adaptive k3 x1.2 30.5 % / 72.0 % (the best), adaptive k6 x1.5
  51.4 % / 76.5 %. Halving the blips makes only the 4-station tours pass.
- Shipped: adaptive k3 x1.2, as a NAMED LIMIT - with a dozen or more
  stations near each other the radar's blips overlap whatever the rule;
  the radar says which way, the list says which one. What would reverse
  the ranking: tours far sparser than "town" (where fixed 150 m comes
  close), which the sweep's families do not include.
