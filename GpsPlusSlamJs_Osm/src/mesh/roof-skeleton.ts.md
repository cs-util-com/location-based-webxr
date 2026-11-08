# roof-skeleton.ts

## Purpose

The roof over any footprint, courtyards included: a weighted straight
skeleton computed by simulating the wavefront. Every wall line moves inwards
at its own weight; the surface it sweeps is its roof plane. Weight 1 is a
slope, weight 0 stays put and sweeps a vertical gable. Planned and decided in
`GpsPlusSlamJs_Docs/docs/2026-11-07-2130-osm-skeleton-roof-and-geometry-review-fixes-plan.md`
(M2); `roof.ts` is the one production caller and owns the fallback ladder.

## Public API

- `skeletonRoof(rings, options?): SkeletonRoof`
  - `rings`: outer ring first, then courtyards. Either winding, a repeated
    closing point allowed.
  - `options.weights`: one array per ring, one weight per wall of the ring AS
    GIVEN (wall `i` runs from corner `i` to `i + 1`). Default 1. Of collinear
    walls merged by the preparation, the first one's weight counts.
  - `options.gableEnds`: `{ kind: "neighbours" }` or
    `{ kind: "axis", axis }`. Runs an all-slopes pass first and turns the wing
    ends it picks into gables (weight 0). Candidates are outer walls whose
    whole slope is one triangle resting on the wall. `neighbours` takes a
    candidate when neither neighbouring wall is one; `axis` takes those whose
    wall normal lies within 45 degrees of `axis`.
    - A wing end is found with runs of corners within `END_APEX_M` (1 cm)
      counted once: the nudge splits one hip apex into events a fraction of a
      millimetre apart, and that sliver must not make the end a
      quadrilateral.
    - **Only wing ends are candidates, also for `axis`.** On a quadrilateral
      tagged `roof:orientation=across` the gables belong on the long walls,
      whose slopes are trapezoids, so `axis` finds none and the roof comes
      back all slopes with `gables === 0`. `roof.ts` then draws the box roof
      where it fits (39 of the corpus's 52 across-tagged skeleton roofs on
      2026-11-08). Choosing end walls by position along the axis instead
      would also pick the outer side wall of an L's other wing; that rule is
      a follow-up, not settled here.
  - `options.maxT`: stop at this time and close what is left with flat caps
    (`SkeletonRoof.caps`). Must be positive.
  - `options.attempt`: a different deterministic nudge per attempt, so a retry
    is a different run.
  - Throws `SkeletonFailure` (and only that, for bad input) for: fewer than
    three usable corners, non-finite coordinates, a ring that is not simple
    (crossing or touching walls), a courtyard outside the outer ring or
    nested in another, `maxT` not positive, a run that loses its way
    (`MAX_STEPS_PER_WALL`), and a result that fails the soundness check.
- `SkeletonRoof`:
  - `faces`: one per wall piece, with `ring`, `wall` (the GIVEN index),
    `vertical`, `weight`, the inward unit normal `nx, ny`, the wall direction
    `dx, dy`, and `points`: the face outline as `{x, y, t}`, eave points at
    `t = 0`.
  - `caps`: flat polygons left by `maxT`, at `t = ridgeT`.
  - `ridgeT`: the latest time reached, the top of the roof.
  - `gables`: how many walls `gableEnds` turned into gables.
- `skeletonFootprint(rings): SkeletonFootprint` - the footprint of a roof
  ladder (`roof.ts`): prepared and checked once, then `hipped(attempt)` and
  `gabled(attempt, gableEnds)` give exactly `skeletonRoof(rings, { attempt })`
  and `skeletonRoof(rings, { attempt, gableEnds })`. The all-slopes run of
  each attempt is made at most once: the gabled rung chooses its gables from
  it and the hipped rung after it is that run, so a failing gabled ladder
  costs four runs, not six; a run that threw is thrown again at once.
  Throws `SkeletonFailure` at once for a ring the preparation rejects (not
  simple, fewer than three corners, not finite), which no nudge changes, so
  the ladder skips all its rungs. No weights or `maxT`: the tagged path uses
  neither.
- `faceTriangles(face)`, `capTriangles(cap)`: triangles in plan (the
  library's `triangulate`), as the face's own points.
- `skeletonPlanArea(roof)`: the plan area of the slopes and caps.

## For invented roofs (M8)

`maxT` and the caller-given ring exist for roofs nobody tagged. `rings` is
the ring the roof STANDS ON and every check works against it: the tagged path
passes the footprint, an invented roof with a 0.32 m eave overhang passes its
offset ring, and the area check and the eave snap then use that ring. With
`maxT` an invented roof cannot grow taller than a limit on a deep building.
The tagged path uses neither: its pitch is `rise / ridgeT`, uncapped.

## Invariants and assumptions

- Preparation, in this order:
  - duplicate corners and corners within `COLLINEAR_M` (0.1 mm) of the line
    through their neighbours are dropped;
  - every remaining corner is nudged by up to `JITTER_M` (0.5 mm) per axis,
    deterministically (`stableNudge` from `stable-jitter.ts`, keyed by the
    attempt, the ring and the rounded corner), so no two walls are exactly
    parallel and no two events coincide. The corner is keyed relative to the
    outer ring's lowest corner (smallest x, then y), not by its frame
    coordinates, so the same house drawn anywhere in the frame (another tile
    origin, another start corner) gets the same nudge and the same roof
    (M2 review finding 7; `roof-skeleton.test.ts`, "the same roof wherever
    the frame puts it");
  - after the run every face's eave points are snapped back to the given
    corners, and the dropped collinear corners are put back into the face of
    the wall they lay on, so the roof meets the unnudged walls exactly.
- Brute force on purpose: the next event is searched afresh each step, O(n^3)
  at worst. The caller caps the corner count (`roof.ts`,
  `SKELETON_VERTEX_CAP`). Positions come from the two wall lines that define
  them, so no error accumulates.
- Soundness check (`assertSound`): every number finite, the plan area within
  `AREA_TOLERANCE` (0.4 %) of the given ring's, and every slope's centroid
  inside the outer ring and in no courtyard.
- Deterministic: the same rings and options give the same roof, bit for bit.
- **Sweeps** (2026-11-08; the 508 ridged roofs of the 13 corpus fixtures
  through `buildRoof`, plus 2,000 random stars of 13 to 40 corners). Counts
  are skeleton / approximate skeleton / hipped fallback / prism; "first" and
  "both" count stars whose first nudge, or both nudges, failed:
  - `JITTER_M`: 0.1 mm 76 / 13 / 1 / 2, first 2, both 0; 0.2 mm the same;
    **0.5 mm (kept)** 77 / 13 / 0 / 2, first 2, both 0; 1 mm 77 / 13 / 0 / 2,
    first 4, both 0; 2 mm 76 / 13 / 1 / 2, first 4, both 0. The verdict (no
    star fails both nudges, no drawn top moves) holds from 0.1 to 2 mm;
    0.5 mm sits in the middle and far under any mapper's precision.
  - `AREA_TOLERANCE` at 0.1 %, 0.2 %, 0.4 % (kept), 1 % and 2 %: identical
    corpus and star counts. The check catches gross failures (a fold, a lost
    face), not drift, so its value is not critical in that range.
  - Gable rule: marking every wing end a gable, rather than only those whose
    neighbours are not wing ends, draws the corpus identically, so the
    corpus does not decide between them; the neighbour rule is kept as
    planned.
  - Axis angle of the tagged rule at 30°, 45° (kept) and 60°: identical
    corpus. The tagged roofs the rule misses are across-tagged
    quadrilaterals, whose gable walls are no wing ends at any angle (above,
    and `roof.ts.md`).

## Examples

```ts
const roof = skeletonRoof([
  [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ],
]);
roof.ridgeT; // 5: the ridge is 5 m in from the long walls
const gabled = skeletonRoof(rings, { gableEnds: { kind: "neighbours" } });
gabled.gables; // 2 on a rectangle: both short ends
```

## Tests

- `roof-skeleton.test.ts`: rectangle, snap, collinear corners, winding,
  weights (CW rings too), `maxT`, determinism and attempts, L/T/U against
  closed forms, a courtyard, gable rules (neighbours and axis), an offset
  ring with a soffit and `maxT`, and every refusal.
- `roof-skeleton.property.test.ts`: star polygons (area within 0.5 %, no
  point outside by more than 1 cm, no NaN, no fold), and a convex oracle: on a
  convex ring `t` is the distance to the nearest wall line; and
  `skeletonFootprint` against `skeletonRoof` (the same roofs or the same
  failure, the rungs in either order), plus a bow tie it rejects up front.
- Through `roof.ts`: `s3db-roof-tags.test.ts`, `mesh-orientation.test.ts`,
  `s3db-drawn-top.test.ts`, and the `buildRoof` fuzz.
