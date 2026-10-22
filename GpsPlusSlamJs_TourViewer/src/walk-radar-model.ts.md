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
- `WALK_RADAR_ADAPTIVE: WalkRadarAdaptiveRule = { k: 2, factor: 1.2,
minM: 10, maxM: 600, shrinkBelow: 0.65 }` (module-local; the default
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
- Frozen draws north from the snapshot's heading and no view cone: the
  radar is heading-up, so a frozen cone would claim a live view that does
  not exist (W4's prototype draws none frozen either).
- No heading: no blips, no cone, no north; dashed rings for the stations
  still to find (found and skipped left out).
- `pending` draws no stations at all (W4's searching rings).
- A blip's angle is `bearingDeltaDeg(bearing, heading)`; its radius
  `R * sqrt(min(d, range) / range)`, clamped to `R - 8`.
- Weak fades every blip to 0.5 (W4's prototype; the plan says "nearby").
- No station is labelled with a distance: the rings carry the scale, the
  list the distances (§1.2).
- At most one focus: the row the guide names `next`, never while frozen.
  Which station that is (and that there is none in R-2's condition, §1.9)
  is the guide's since M4 (`walkFocus`); the radar no longer hides it
  itself, so a target the visitor chose stays orange under too-weak GPS
  (R-4).

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
  96-144 px; at most one focus, only on the guide's `next` row, none
  frozen; the blur grows with accuracy and is at least 7 px; a frozen model
  is the same for two different live geometries.
- `walk-radar-model.sweep.test.ts` (about 8 s; the full grid with
  `WALK_RADAR_SWEEP_FULL=1`, about 2 min) - the overlap sweep, table to
  `WALK_RADAR_SWEEP_OUT`.

## The overlap sweep's verdict (2026-10-22, extended)

- Parameters: tours "town" (stations 25-50 m apart, turns up to 60°, 4,
  12, 30 and 100 stations) and "museum" (3-6 m apart, turns up to 120°,
  4, 12, 30), eight seeds, five samples per leg, the nearest unfound the
  focus; rules fixed 150 / 300 / 600 m and adaptive k 1-6 x 1.0-1.5 with
  floors of 5, 10, 15, 20 and 30 m, each with the production hysteresis;
  sizes 96-144 px; extra runs with blips at 0.5 and 0.75 scale. The
  default run (about 8 s) sweeps k 1-3 x 1.0-1.35 with floors 5, 10 and
  30 m at 132 and 108 px; `WALK_RADAR_SWEEP_FULL=1` the whole grid
  (about 2 min).
- Pass bar (per tour, at 132 and 108 px): the focus clear in at least 95 %
  of positions AND at most 10 % of the unfound blips overlapping.
- Also reported: the GPS blur's radius over the rim's at an accuracy of
  5, 10 and 20 m (a low floor clears a museum's blips but blows the blur
  up over the radar).
- Result: NO rule passes for every tour. Mean over tours and the two
  shipped sizes, focus overlapped / unfound overlapping:
  - fixed 300 m: 81.8 % / 94.3 %; fixed 150 m: 57.5 % / 85.3 %;
  - adaptive k3 x1.2 floor 30 m (shipped before): 30.5 % / 72.0 %;
  - k3 x1.2 floor 10 m: 19.5 % / 64.1 %;
  - k2 x1.2 floor 10 m (shipped): 14.5 % / 65.5 %;
  - k2 x1.35 floor 10 m: 14.8 % / 65.2 %; k3 x1.0 floor 10 m: 16.1 % /
    64.0 %; k2 x1.2 floor 5 m: 14.7 % / 66.3 %;
  - k1 (any factor, any floor): 36-44 % / 69-76 %; k4-6 at floor 10 m:
    25.8-43.5 % / 65.2-70.4 %; factor 1.5: worse than 1.2-1.35 at every k.
- The floor is the museum's lever and does nothing in town (every town
  range is above 30 m). Museum, k2 x1.2, focus overlapped / unfound
  overlapping, and the GPS blur's share at 5 / 10 / 20 m accuracy:
  - floor 5 m: 15.9 % / 56.9 %, blur 0.83 / 0.99 / 1.00;
  - floor 10 m (shipped): 15.5 % / 54.8 %, blur 0.67 / 0.94 / 1.00;
  - floor 15 m: 20.3 % / 54.2 %, blur 0.58 / 0.82 / 1.00;
  - floor 20 m: 29.0 % / 59.9 %, blur 0.50 / 0.71 / 1.00;
  - floor 30 m: 44.4 % / 72.0 %, blur 0.41 / 0.58 / 0.82.
  - museum4 passes the bar at 132 px with a floor of 5 or 10 m (98.3 %
    clear, 10 % overlapping), never at 30 m.
- Verdict across the range: the least overlap is a flat plateau (k 2-3,
  factor 1.1-1.35, floor 5-15 m, within about a point of each other),
  not a corner of the grid: k 1 and k 4+ are worse, factor 1.5 is worse,
  a floor of 30 m is far worse in a museum and 5 m buys nothing over
  10 m. Shipped: k2 x1.2 floor 10 m, inside the plateau. Its overlap
  remains a NAMED LIMIT: with a dozen or more stations near each other
  the blips overlap whatever the rule; the radar says which way, the
  list says which one ("draw only the N nearest at full size" is the
  design change that would move it).
- The price of the 10 m floor: in a museum guided by GPS alone, a 10 m
  fix's blur covers about 94 % of the rim (58 % at 30 m). Under a code
  (the usual museum case) there is no blur. A floor tied to the accuracy
  (max(10 m, 2 x accuracy)) would bound the blur at 71 % of the rim at
  the cost of the 20 m row's overlap under a 10 m fix; not built (a
  mechanism for a case the field has not shown).
- What would reverse it: tours far sparser than "town" (fixed 150 m comes
  close there), a field test showing museums guided by GPS rather than
  codes (then the accuracy-tied floor), or the phone showing the blips
  readable when overlapping.
