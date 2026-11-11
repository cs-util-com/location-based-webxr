# `src/mesh/roads.ts`

## Purpose

Road ribbons (W13, DEC-R2-12 / DEC-R2-13) — the hardest builder in round 2. One
merged surface per way, draped on terrain. Since M4a of the city objects plan
(`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`)
each way is one mitred strip rather than a quad per segment plus a disc at every
vertex, and the classes are stacked by a small lift so a carriageway covers a
footway crossing it.

## Public API

- `roadWidthM(tags) → number` — drawn width in metres. **Never `NaN`, never 0.**
- `isRoad(feature) → boolean` — whether this builder owns the feature.
- `BuildRoadsOptions` - `{ frame, groundHeightM?, mitreLimit?, rankStepM? }`.
  - `mitreLimit` (default `ROAD_MITRE_LIMIT` = 2): the longest mitre, as a
    multiple of the half-width, before a join is bevelled. 2 bevels turns over
    120 degrees. Must be finite and at least 1, else `RangeError`.
  - `rankStepM` (default `ROAD_RANK_STEP_M` = 0.005 m): the lift between two
    road classes. Must be finite and at least 0, else `RangeError`; 0 puts every
    road on the ground.
- `roadRank(tags) → 0 | 1 | 2 | 3` - the class order: paths (footway, path,
  steps, pedestrian, cycleway, bridleway, platform) 0, `track` / `service` 1,
  `residential` / `living_street` / `unclassified` 2, everything else 3.
- `ROAD_MITRE_LIMIT`, `ROAD_RANK_STEP_M` and `roadRank` are exported from
  this module for its tests, NOT from the package entry (M4a review MINOR 4):
  no production caller needs them, and a consumer sets the look through
  `buildCity`'s `roads: { mitreLimit, rankStepM }` (`CityRoadOptions`, see
  `city.ts.md`), which passes them through to the validation below.
- `roadMarkingLiftM(rankStepM?)` - the top rank lift plus 5 mm: where
  zebra paint sits (0.025 m by default), over every road class.
- `pedestrianAreaLiftM(rankStepM?)` - minus one step (0 for a zero step):
  a pedestrian area sits under the paths that cross it. Both used by
  `buildCity` with its own `rankStepM`, so a zero step still layers right.
- `RoadRibbon` — `{ feature, widthM, liftM, mesh }`; `liftM` is the way's rank lift, which `road-surface.ts` subtracts to find the ground a ribbon draws on.
- `buildRoads(features, options) → RoadRibbon[]` - in input order. Throws only
  on invalid options (above); a degenerate way yields an empty mesh rather than
  `NaN` geometry.

## Invariants & assumptions

- **Decomposable over a delta: each ribbon depends on its own way alone.**
  Building two halves and concatenating gives exactly the whole call's
  ribbons. M4a's first cut (r1161) broke the strip at every node another way
  shared, which made it depend on the whole call; the review's MINOR 3
  (r1164) dropped that break. Pinned by `roads.test.ts` ("builds every way
  from its own geometry alone"), `roads.property.test.ts` (random networks,
  alone equals together) and
  `GpsPlusSlamJs_OsmDemo/src/worker/mesh-decomposability-evidence.test.ts`
  (roads back among the builders that can run over a delta, on real
  fixtures).
- **Width comes from LANES, not from the highway class.** Precedence: `width`
  tag → `lanes` × lane width → the class's default lanes × lane width. This is
  the resolution of round 2's last open `[confirm]`, and the oracle is
  `streets-gl` (see
  `GpsPlusSlamJs_Docs/docs/2026-07-30-1520-streets-gl-road-modelling-findings.md`).
  A flat per-class table cannot tell a two-lane primary from a six-lane one, and
  `lanes` is well-mapped on exactly the classes where width varies most.
- **A single lane gets 4 m, not 3.** Not a rounding convenience: a one-lane
  road's drawn width must cover the carriageway plus the verge that makes it
  passable. Three metres for a one-lane residential street reads as a footpath.
- **`service` gets 1 default lane where `streets-gl` gives it 2** (F9). It is
  driveways and parking aisles, numerous in a residential working set and not two
  lanes wide. Expressed as a lane count rather than a width override, so there is
  still one mechanism.
- **Paths bypass the lane model entirely** — `footway`/`path`/`steps`/
  `pedestrian`/`platform`/`bridleway` 2 m, `cycleway` 3 m. A footway has no
  lanes, and multiplying a fictional lane count by a lane width is arithmetic
  dressed up as data.
  - **`PATH_WIDTH_M` is the file's one path list**: `isPedestrianPath` tests
    its keys and `ROAD_RANK` derives its rank-0 entries from them, so a path
    class cannot reach one of this file's tables alone. The colour list
    (`PEDESTRIAN_CLASSES` in `feature-colours.ts`) is still separate; a test
    in `roads.test.ts` pins that the only path outside it is `bridleway`,
    over the common `highway` values OSM documents for ways. That happened once (#909 review):
    `platform` was in the rank table only, so a `highway=platform` way drew
    6 m wide (the unknown-class width) and took `surface` first for its
    colour.
  - **`platform` is a bus or tram platform mapped as a way** (OSM wiki,
    `Tag:highway=platform`: where passengers wait, a pedestrian surface), so
    it takes the pedestrian width, 2 m, and the pedestrian colour
    (`feature-colours.ts`). OSM2World gives `platform` and `pedestrian` alike
    4 m; this package gives both 2 m, and a tagged `width` wins either way.
    It is also a pedestrian path for routing (`isPedestrianPath`), walkable
    along like a footway.
- **`parseLengthMetres`, never `Number`, for the `width` tag.** `width=7 m` is
  ordinary and `Number` returns `NaN`, which the fallback would then swallow — a
  tagged road silently becoming an untagged one at a plausible width. The tree
  builder learned this first.
- **The class tables (`DEFAULT_LANES`, `PATH_WIDTH_M`) are `Map`s** (M1 review
  finding 2, 2026-11-08): on plain objects `highway=constructor` found an
  inherited function as its width and `toString` counted as a footpath. Every
  prototype name now gets the unknown-class width and is not a path.
- **A `lanes` value that is not a positive integer is ignored.** `lanes=1;2` and
  `lanes=none` both occur.
- **Geometry is one mitred strip per way, with discs only where a strip cannot
  join (M4a, replacing DEC-R2-13's disc at every vertex).** The disc filled the
  wedge outside a turn by construction, but cost eight triangles at every vertex
  and drew a bump on every gentle curve where its rim overlapped the quads.
  - **An interior vertex is MITRED**: both edges meet at the point on the
    bisector of the two segment normals, `h / cos(t / 2)` from the centre line
    (h the half-width, t the turn). Two triangles a segment, nothing at the join,
    no notch on a near-straight curve.
  - **A sharp turn is BEVELLED**: when `1 / cos(t / 2)` exceeds `mitreLimit`
    (and the gap between the two outer corners is at least 1 mm; a smaller gap
    is mitred, since limit 1 would otherwise bevel float noise into a sliver)
    the outer side keeps both segment corners and one triangle closes the gap;
    the inner side still meets at the mitre point.
  - **The DISC survives where a strip cannot join**: at both ends (the rounded
    cap), and as a FALLBACK when the inner mitre would reach past half of
    either neighbouring segment (`h * tan(t / 2)`), or at a hairpin. There the
    strip breaks into two sections, each ending flat, and the disc covers both.
  - **A JUNCTION IS NOT A BREAK (M4a review MINOR 3, r1164).** A way runs
    through a node it shares with another way like through any other point,
    mitred where it turns, bevelled or a fallback disc where the angle says so;
    the way that ENDS there brings its own end disc, which covers the joint.
    r1161 broke both strips there and added a disc: without a kerb that bought
    nothing visible, cost eight triangles a junction and made roads
    non-decomposable. The same holds for a point one way visits twice (a
    figure eight): mitred, no disc. Junction coverage on random networks is a
    property test.
  - **Triangle count is exactly 2 per segment + 1 per bevel + 8 per disc**, never
    more than the old count. Measured on the three O3 scenes (disc per vertex,
    then r1161 with junction breaks, then r1164): Heidelberg 8,884 / 5,164 /
    4,700, Meggen 18,490 / 10,786 / 8,450, Park Slope 11,404 / 9,484 / 6,292
    (r1164 pinned in `testdata/sites/site-roads.test.ts`). Swept on r1164
    (r1167): limit 4 draws the same as the default 2, 1.5 one triangle more
    per scene, and 1 (every join bevelled) 5,206 / 9,567 / 6,734, 7 to 13 %
    more.
  - **What M4a's spec asked for, and how the strip answers it**: the spec was
    written for O3's first answer, dropping the disc on near-straight vertices
    (`straightDeg`, a notch limit); the owner then chose the mitre strip, which
    has no such parameters because it leaves no notch to limit. O3's kerb lines
    and their `kerbTaperM` are NOT ported: plan §3 left the kerb in the lab.
- **Classes are stacked by a lift, not by draw order (M4a class order).** A way
  of rank r sits `rankStepM * (r + 0.4 * f)` above the ground, its strip and
  its discs alike, where f in [0, 1) is a 32-bit hash (FNV-1a) of the feature
  key, so two ways of one class at a junction rarely share a depth. It does
  not rule a tie out: two ways of one class sit 0 to 0.4 step apart, and two
  close fractions are as good as a tie at any step (see "The gaps per step"
  below). So a carriageway
  covers a footway that crosses it. A way's discs sit at its strip's own height
  (owner decision 2026-11-09, r1171), coplanar only with that strip, whose
  colour they share; until r1171 they sat half a step under it, which left a
  higher class's end disc 0.1 step (0.5 mm) over a lower class's strip, a gap
  the depth buffer does not resolve (see the depth spike below). At the default
  5 mm step the highest road is 3.4 steps = 1.7 cm up, under the 4 cm rung
  `layer-order.ts` gives roads above the plates. Whether these millimetres separate
  on screen was measured: see the depth spike below.
  - **The rank reads `highway` only; `bridge` and `layer` are ignored**, so a
    footbridge over a primary is drawn under it where they overlap. Filed, not
    fixed (M4a review MINOR 5):
    [`2026-11-09-1241-road-class-order-ignores-bridge-and-layer-followup.md`](../../docs/2026-11-09-1241-road-class-order-ignores-bridge-and-layer-followup.md).
- **Terrain is sampled PER VERTEX**, like the plates and unlike a building. A
  road is a long surface; one sample would cut into the hill at one end and float
  at the other — the artefact DEC-R2-19 removed.
- **Consecutive duplicate points are dropped, and a way with fewer than two
  distinct points yields an EMPTY mesh.** A zero-length segment has no direction,
  so its quad normal is `0/0` — and a single `NaN` deletes the entire draw call
  in three.js with no error.
- **Who owns the feature, stated as exclusions rather than hoped for:**
  - Nodes are not roads.
  - `tunnel=yes` / `covered=yes` are skipped (F10). Drawing a tunnel as a surface
    ribbon puts a road across ground it runs beneath — a plausible lie.
  - `area=yes` is skipped: `highway=pedestrian` + `area=yes` is a surface and
    belongs to the plate builder.
- **`three`'s `Line` with `linewidth > 1` is unsupported on every major
  platform.** This is triangulated geometry either way; it is not a choice being
  made here.

## The depth spike (M4a, 2026-11-09): do millimetre ranks separate on screen?

Measured, not assumed: a 2 m footway under a 12 m carriageway at a given
vertical gap, rendered by three.js in Chromium, 12 frames with up to 5 cm of
camera wobble, counting the carriageway pixels where the footway shows
through. Views: OsmDemo's camera (near 0.5 m) at 41 m, at its 226 m boot view,
at 570 m and low at 100 m; the globe's eye camera at landing (near 0.51 m) 30
and 100 m from the crossing; the Tour Editor's camera (near 0.3 x height) 30 m
and 300 m up. Two renderers: an Intel Iris Xe through ANGLE/D3D11 (a real GPU)
and SwiftShader (the software renderer CI's browsers use). Both report a
24-bit depth buffer. Percentages are of the overlap's pixels. A pixel counts
only where both strips cover it in their own mask renders of the same frame,
so a counted pixel is a lost depth test, not an edge. r1167 measured each gap
at three crossing positions (the crossing at the look-at point and moved
15 m and 18 m off it, the camera following), because a threshold read at one
position moved by a millimetre between them.

- **The 0 mm column (main before M4a: every road coplanar) was added in r1164**
  so "better than before" is measured: on the real GPU 8-66 % of the overlap
  fights in every view (36 % at 41 m, 19 % at 226 m, 66 % in the editor at
  300 m). On SwiftShader two views read 0 at 0 mm (globe landing 100 m, editor
  300 m): the coplanar tie resolves the same way every frame there, so those
  views cannot show fighting at all, which is not a clean gap.
- **(a) Geometric gaps (what the builder does), real GPU.** Clean at every
  gap from 1.5 mm at all three positions in the close views (OsmDemo 41 m
  and low 100 m, globe 30 and 100 m, editor 30 m; from 0.5 mm at the
  look-at point, r1164), in the editor at 300 m and in the deep globe view
  at 200 m. **OsmDemo's 226 m boot view is the binding one**: 10.2 / 2.6 /
  1.5 % at 1.5 mm, 9.3 / 1.5 / 1.3 % at 1.7 mm (the three positions),
  2.4 / 1.7 / 0 % at 2.8 mm, 0 / 1.0 / 0 % at 3 mm, clean from 3.4 mm.
  **OsmDemo at 570 m fights at every gap up to 10.2 mm** (3-37 % of about 96
  pixels; 7.3 / 24.0 / 5.2 % at 10.2 mm) and is clean or 3 pixels from
  16.8 mm. r1164's sentence that it showed 3 of 96 pixels at every gap up to
  20 mm and was therefore edge noise was wrong twice: 10 and 20 mm read 0
  there, and the mask method cannot count an edge.
- **SwiftShader** (CI's renderer) is worse everywhere and no gap up to 18 mm
  is clean in every view: at 3 mm the 226 m view fights 1-48 %, the low
  100 m view 13-58 %, the editor at 300 m 0-57 %; at 10.2 mm the deep globe
  view 0-16 %, 570 m 0-12 % and the editor at 300 m 0-27 %; at 18 mm 570 m
  (5.4 %) and the editor at 300 m (6.7 %) still fight at one position each.
  The editor's 0 % at the look-at point is the coplanar tie resolving one way
  every frame there; 15 m off it the same view fights 67 % at 1.5 mm.
- **The globe landing at 200 m, measured properly (r1164).** r1161 read n/a:
  a 12 m crossing 200 m from a 1.7 m eye is under one pixel row. A deep
  overlap (a 20 m wide way under a 100 m wide one, 60 m deep) gives 1,152
  pixels: on the GPU 65.6 % at 0 mm, 19.3 % at 0.5 mm, 7.3 % at 1 mm, clean
  from 1.5 mm; on SwiftShader 100 % up to 5 mm, 16.4 % at 10 mm, clean at
  17 mm. Globe roads sit 2 m above the relief (`placeRoad`), so this view
  is about the roads among themselves.
- **(b) A polygon offset per rank.** With the slope factor (factor = units = 1)
  it is clean between roads in every view, but the same offset at 3 pulls a
  road through a layer 4 cm above it in EVERY view on both renderers (100 %):
  the factor scales with the surface's depth slope, which at an oblique view is
  decimetres a pixel, so it would break OsmDemo's 4 cm ladder (areas and heat
  cells over the roads). Units alone (no factor) fight in most views (5-60 %).
- **The gaps per step, and what each leaves.** Before r1171, the builder's gaps were: between
  two classes' strips at least 0.6 step, a higher class's END disc over a
  lower class's strip at least 0.1 step (discs exist only at ends and
  fallbacks since r1164), two ways of one class anywhere from 0 to 0.4 step
  (a tie wherever their tie fractions are close, at any step). Real GPU,
  three positions unless named otherwise:
  - **5 mm (before r1171)**: strips 3 mm apart, clean except 226 m (one position,
    1.0 %) and 570 m (3 / 25 / 16 %); end discs 0.5 mm, fighting 12.6 % at
    226 m, 31.9 % in the editor at 300 m and 19.3 % in the deep globe view
    (r1164, look-at point only).
  - **17 mm**: strips 10.2 mm, clean except 570 m (5-24 %); end discs
    1.7 mm, clean in the editor at 300 m and the globe, **NOT at 226 m (9.3 /
    1.5 / 1.3 %)** nor at 570 m. r1164 said the 17 mm disc gap was clean on
    the GPU everywhere; it read 1.5 mm's 0 from views other than 226 m.
  - **28 mm**: strips 16.8 mm, clean except 3 pixels (3 %) at 570 m at one
    position; end discs 2.8 mm, still 2.4 / 1.7 / 0 % at 226 m and 16-38 %
    at 570 m.
  - **34 mm**, the smallest MEASURED step whose end-disc gap (3.4 mm) is
    clean on the GPU at 226 m and in the editor at 300 m at all three
    positions. Nothing between 3 mm (clean at two of three, 7 pixels at the
    third) and 3.4 mm was measured, so a 31-33 mm step is untested; the
    verdict rests on three positions of about 640 pixels each (1 pixel is
    0.16 %), and a fourth position or more frames could move the threshold
    either way. Strips 20.4 mm apart (18 mm measured clean but for 3 pixels
    at 570 m); the top road sat 3.9 steps = 13.3 cm up before r1171 (3.4 steps =
    11.6 cm since), so OsmDemo's 4 cm ladder would widen to about 12-14 cm. End discs at 570 m still fight
    (11-19 % at 3.4 mm).
  - Main before M4a (0 mm): 8-66 % in every view.
  - Phone GPUs were not measured; SwiftShader is above.
- **The alternative for the end discs, measured in r1164 and BUILT in r1171
  (owner decision 2026-11-09; its real-code numbers are in the next
  section).** Placing a way's discs at its strip's own height instead of half a
  step below makes the disc-over-lower-strip gap equal the strip gap (0.6
  step) and leaves a disc coplanar only with its own strip, whose colour it
  shares. At 5 mm that is 3 mm: on the GPU 0 / 1.0 / 0 % at 226 m, clean in
  the editor at 300 m and the globe, so it **reduces the 0.5 mm disc case
  from 12.6 % to at most 1.0 % at 226 m without a larger step**, and clears
  it in every other view but 570 m, which fights at 3 mm for strips anyway.
  At 17 mm it is 10.2 mm, clean but for 570 m. Discs a quarter step below
  their strip (half of today's drop) give 0.35 step: 1.75 mm at 5 mm, 9.0 /
  1.5 / 0.3 % at 226 m, so no better than the 17 mm step's discs. The drop
  exists so a way's own disc does not poke through its strip; unmeasured
  here is how much a per-vertex drape on a slope moves a disc rim against
  the strip (the spike is flat), which matters for every option above that
  relies on a few millimetres. (Measured in r1171: see the drape bullet in
  the next section.)
- **So the step stayed 5 mm (the owner kept it on 2026-11-09).** No candidate is clean
  everywhere: 570 m fights up to 10.2 mm on the GPU, SwiftShader up to
  18 mm, and one class's ties do not depend on the step. The cheapest
  measured improvement is the end-disc alternative at 5 mm. A larger step
  is needed only to clear 226 m's end discs (a 34 mm step, gap 3.4 mm) or
  570 m's strips (a 28 mm step, gap 16.8 mm, 3 pixels left at one
  position); a 17 mm step clears neither. Each widens OsmDemo's 4 cm
  ladder. A 17 mm variant (ladder 8 cm) was tried and is not committed.
- **Real scenes did not separate the variants (r1164).** OsmDemo's Heidelberg
  corpus (boot view 226 m, a close view) and the Tour Editor globe at 300 m,
  shot with main, r1161, r1164 and the 17 mm variant, a camera nudge against
  a re-shot floor: every nudge count sat at its own floor (within about 60
  of 1.3 million pixels), and the variants differed less than the floor moved
  between runs. At those distances roads are a few pixels wide and their
  overlaps a handful, under the method's noise. The two Schlossberg views
  (a residential street ending on a service road, on the castle hill) put the
  camera behind the hill and show no roads, so they are no evidence either
  way. The spike above is the quantitative evidence; the owner decided on it
  (next section).

## The decision and its numbers on the real code (r1171, 2026-11-09)

The owner kept the 5 mm step and moved the discs to their strip's height; no
wider ladder. Measured again with the real `buildRoads` (bundled from the
source before, c1ecfcba0, and after), not a stand-in pair of quads. Three
cases: **end** (a service way ending on a footway: its end disc over the
footway's strip, the case the change targets), **lowEnd** (the footway ending
under the service way: its end disc under the service strip) and **cross** (two strips crossing, no disc; its gaps are equal before and
after, so it is the control: it shows what the strips' 2.5 mm absolute shift
alone does to the depth quantisation). Feature keys chosen for the worst tie
fractions (footway f near 1, service f near 0); footway 2 m, service 12 m
(20 m and 100 m for the deep globe view). Percent of the overlap's pixels
losing the depth test, three crossing positions, 12 frames each.

- **Real GPU (Iris Xe, ANGLE/D3D11), flat, 5 mm, end case, before -> after**
  (the three positions):
  - OsmDemo close 41 m: 0 / 0 / 0 -> 0 / 0 / 0
  - OsmDemo 226 m boot view: 4.56 / 13.84 / 12.58 -> 0 / 0.31 / 0.16
  - OsmDemo 570 m: 25.0 / 15.6 / 8.5 -> 21.9 / 20.8 / 6.1 (fights for strips
    anyway; noise both ways)
  - OsmDemo low 100 m: 1.04 / 1.67 / 1.67 -> 0 / 0 / 0
  - Globe landing 30 m: 0 -> 0; 100 m: 9.6 / 6.7 / 5.8 -> 0 / 0 / 0
  - Globe landing 200 m deep: 7.6 / 7.2 / 7.1 -> 0 / 0 / 0
  - Editor 300 m: 33.6 / 33.6 / 33.1 -> 0 / 0 / 0; editor 30 m: 0 -> 0
- **The step swept at 3, 5 and 8 mm, flat and on a 25 % slope** (camera fixed,
  the scene moved by 0, 1.3, 2.5 and 3.7 mm against the quantisation, three
  positions each: mean / max percent over the 12 readings), 226 m and the
  editor at 300 m:
  - end, 226 m, flat: before 10.5 / 15.4, 8.7 / 13.8, 6.5 / 11.2; after
    2.9 / 7.1, 0.5 / 2.4, 0 / 0
  - end, 226 m, slope: before 15.5 / 41.7, 6.0 / 12.2, 6.1 / 11.6; after
    12.7 / 24.3, 2.4 / 6.3, 0.2 / 1.6
  - end, editor 300 m: before 5.7-16.1 mean, 22-36 max at every step and both
    grounds; after 0 everywhere
  - lowEnd, 226 m, flat: before 4.0 / 7.0, 2.1 / 5.1, 0 / 0; after
    5.3 / 11.0, 2.0 / 5.9, 0.2 / 0.8
  - lowEnd, 226 m, slope: before 10.2 / 25.3, 1.6 / 4.2, 0.1 / 1.3; after
    18.4 / 35.3, 2.5 / 7.5, 0.9 / 3.1
  - cross (control), 226 m, flat: before 5.0 / 8.8, 1.6 / 3.5, 0 / 0; after
    4.5 / 10.8, 1.6 / 4.9, 0.1 / 0.5
  - cross (control), 226 m, slope: before 8.9 / 22.7, 1.3 / 3.9, 0.1 / 0.7;
    after 15.1 / 27.1, 1.7 / 5.0, 0.6 / 2.1
  - lowEnd and cross in the editor at 300 m: 0 before and after.
- **SwiftShader** is dominated by quantisation: the cross control alone swings
  from 5.5 to 86.7 % in the editor at 30 m at 3 mm between before and after,
  with equal gaps. At 5 mm flat the end case improves in most views (close
  41 m about 20 -> 0.2 %, 226 m 22-25 -> 14-17 %, editor 300 m 62 -> 45 %,
  globe 30 m about 7 -> 0.5 %, editor 30 m 2.2 -> 0), and some cells get
  worse together with the control (low 100 m on the slope: lowEnd 0 -> 22 %,
  cross 0 -> 12.8 %), so they are read as the shifted pattern, not the discs.
- **The slope result.** The end case gains on the slope as on the flat. The
  lowEnd case is the one that moves the other way: at 5 mm on the 25 % slope
  its mean at 226 m rises 1.6 -> 2.5 % while the control rises 1.3 -> 1.7 %,
  so about 0.5 points beyond the strips' shift; at 3 mm +8.2 against +6.2.
  The rise is geometric, not noise, and its sign is expected: the footway's
  end disc under the service strip used to sit half a step below its own
  strip, so its gap to the service strip shrinks from 1.1 to 0.6 step (5.5 to
  3 mm at 5 mm), exactly the strip-over-strip gap the cross control already
  has. lowEnd after therefore sits just above cross after (5 mm flat 2.0 / 5.9
  against 1.6 / 4.9, slope 2.5 / 7.5 against 1.7 / 5.0), the extra half point
  being the disc's share of the overlap. On the CPU (below) lowEnd is +0.1 to
  +0.5 points worse on a curved hill. Read as: every class gap is now the
  0.6-step strip gap, which is what the owner chose; not a regression to stop
  on. What would reverse it is the 0.6-step strip floor itself proving too
  thin, a step-size question, not this change.
- **The drape on curved ground (CPU, both builds).** The heights a GPU would
  interpolate, sampled every 25 cm over 150 random placements (seed 777) of
  each case at 3, 5 and 8 mm, against a heightfield that is barycentric on a
  12 m triangle grid: on flat ground and planes of 10 and 25 % the end case's
  smallest gap goes from 0.7 mm (14 % of samples under 2 mm) to 3.2 mm (none
  under 2 mm) at 5 mm; cross and lowEnd do not change. On a curved hill (an
  80 m Gaussian, sigma 150 m) **the per-vertex drape itself inverts the order
  in about half of every overlap at any step** (end 28.2 -> 25.5 %, cross
  49.8 % both, lowEnd 55.3 -> 55.5 % at 5 mm), because a strip's straight
  chord between vertices leaves the curved ground by decimetres, against a
  step of millimetres. That error predates the class order and no step fixes
  it; filed:
  [`2026-11-09-2155-road-drape-chord-error-inverts-class-order-followup.md`](../../docs/2026-11-09-2155-road-drape-chord-error-inverts-class-order-followup.md).
- **What would reverse these verdicts:** a slope steeper than 25 % or a tighter
  hill, other tie fractions than the worst pair, more crossing positions, and phone GPUs, which were not
  measured.

## Build time (M4a review MINOR 2, measured r1164)

r1161 reported single runs (Heidelberg 11.2 to 7.5 ms, Meggen 10.7 to 13.1,
Park Slope 6.8 to 11.1, the lab 4.9 to 8.2), too noisy to call a speed-up or
a slow-down. Measured again: `buildRoads` alone, the three O3 scenes,
variants interleaved in one Node 24 process with a GC before each run, 10
warm-up rounds then the median (min-max) of 30, on devbox-win11 under the
machine slot:

- Heidelberg: before M4a 4.85 ms (3.7-7.2), r1161 5.47 (4.5-10.5), r1164
  4.19 (3.5-6.4)
- Meggen: 8.56 (6.6-12.4), 9.41 (7.1-16.7), 6.78 (5.8-13.7)
- Park Slope: 6.61 (5.2-10.4), 8.16 (6.6-13.3), 5.95 (4.5-8.5)

So r1161's junction pass cost about 10-25 % over the disc builder, and r1164
is 10-20 % faster than the disc builder; the ranges overlap, so read it as
"no slower", not as a speed-up to rely on. The lab row was the same
Heidelberg feature set and is covered by the first line.

## Examples

```ts
const ribbons = buildRoads(features, {
  frame: enuFrameAt(userPosition),
  groundHeightM: (p) => field.heightAt(p),
});
const merged = mergeMeshes(ribbons.map((r) => r.mesh));
```

## Tests

- `roads.test.ts`
  - **`roadWidthM`** - the width tag wins (including `7 m`); lanes-derived width;
    the single-lane 4 m rule; per-class defaults; `service` at 4 m; flat path
    widths; an unknown class gets a finite documented default; a malformed
    `lanes` is ignored.
  - **`isRoad`** - accepts a highway way; rejects nodes, untagged ways, tunnels,
    covered ways and highway areas.
  - **`buildRoads`** - a straight way is covered across its width and not beyond
    it; **no gap at a right-angle corner**; **no hole at a three-way junction**;
    per-vertex ground sampling; degenerate ways stay finite; all vertex data
    finite on a real-ish polyline.
  - **The mitre strip** - exact triangle counts for a straight way, a mitre, a
    bevel (90 degrees at limit 1.4, 130 degrees at 2), the short-segment and
    hairpin fallbacks, a way running through a junction (no break, no disc)
    and a figure eight (mitred through its doubled point); **a 4-degree curve
    has no notch**; each way built from its own geometry alone; input order
    does not change the mesh; every triangle faces up; invalid limits throw.
  - **Class order** - the rank table; a carriageway above a crossing footway; a
    way's discs at its own strip's height, never under it; every lift in [0, 2 cm); a zero step puts
    everything on the ground; invalid steps throw.
- `roads.property.test.ts` (fast-check) - on random polylines (3-40 m steps,
  turns up to 175 degrees) and gentle curves, at limits 1, 1.5, 2 and 4: no
  folded triangle, every segment's half-width rectangle and every mitred outer
  wedge covered, ends carry discs, the count is exactly its parts and never
  above the old one. The expected join at each vertex (disc, bevel or mitre)
  is computed in the test from the turn angle, the segment lengths and the
  limit, not from the builder's own rule; a vertex within 1e-7 of a threshold
  is skipped (`fc.pre`). A second property builds random small networks
  (2-5 random walks on a jittered 4x4 lattice, so ways share nodes): no fold,
  every segment covered, every shared node covered by each way through it, and
  each way built alone equals the same way built with the others. (r1161's
  "the build is deterministic" property was dropped as near-tautological.)
  A third property (r1171) lifts every vertex of a way, discs and strip
  alike, by one height above the ground, inside its rank's band
  `[step * rank, step * (rank + 0.4)]`, on random steps (1-10 mm) and on a
  sloped, rippled ground: a disc is never under its strip.
- `testdata/sites/site-roads.test.ts` - the three O3 scenes' counts, pinned.
- `city.test.ts` - `buildCity` passes `roads: { rankStepM, mitreLimit }`
  through (a zero step puts every road on the ground, a 1.2 limit bevels a
  right angle, `{}` equals `true`) and refuses invalid values as the
  builder does.

The coverage tests assert **coverage**, not only counts — a count passes on
geometry full of holes. The helper does a plan-view point-in-triangle test and
explicitly rejects degenerate triangles, so the "not covered" assertions cannot
silently become no-ops. Mutation-checked (M4a): a missing fold guard, mitring
every join, a wrong mitre length and a bevel at the wrong end each fail a test.

## `isPedestrianPath(feature)` — the path-ness signal (DEC-R2)

Whether a way is one a person walks **along**. Added 2026-08-16 for routing, not
for rendering, and it lives here because `PATH_WIDTH_M` — the allowlist it tests
against — already does. A second copy of that list in the demo is the "two
implementations of one predicate" mistake this package has had to fix before.

**It is not the `walkable` score, and the difference is the point.** `walkable`
rates GROUND QUALITY: under "can a person walk on this surface",
`surface=grass` 9 outranking `highway=footway` 3 is correct, because a footway
LINE carries no surface information of its own. Path-ness is a property of the
way. A router wanting "prefer the paths" needs both, as separate multipliers —
asking one number to carry both made the preference track how thoroughly a place
is mapped rather than whether a cell is a path.

**It also answers a case the score structurally cannot.** Scoring is
multiplicative with zero absorbing, so a footbridge sharing a res-13 cell with a
river scores exactly 0 — indistinguishable from open water. The provenance map
still records the footway, so this predicate sees the bridge.

Exclusions are `isRoad`'s, shared deliberately: tunnels and covered ways are not
surface paths (F10), and a `highway` AREA is a plate rather than a ribbon.

Tested in `roads.test.ts` — the allowlist, carriageways and non-highways refused,
the shared exclusions, and nodes (no length to walk along).

## `isBridgeCrossing(feature)` — the bank opener (DEC-R1)

Whether a way is a **ground-level** crossing carried over something. It decides
where a river bank may be opened, so a wrong `true` puts an agent on open water
and a wrong `false` leaves a shipped picker location unroutable.

**Three earlier formulations were each refuted against
`testdata/sites/london-tower-bridge.json`, so every clause names a real way:**

- **Any truthy `bridge`, not `bridge=yes`** — the bascule spans are
  `bridge=movable`, 6 of the 14 ground-level ways at the site the rule exists
  for. An exact match misses the bridge the place is named after.
- **A `highway` is required** — ways 367652753 / 367653917 are
  `bridge=yes building:part=yes min_height=40`, closed areas carrying no way. A
  bare `bridge=*` rule opens the bank along their outline, from 40 m overhead.
- **`layer` must be ground level** — ways 153173986 / 153173987 _are_
  `highway=footway bridge=yes`, at `layer=2`, 43 m up and behind a turnstile. The
  highway clause alone admits them.
  - Absent or non-numeric `layer` reads as ground, matching the tag's default;
    refusing the absent case would drop the common bridge to catch a rare
    mis-tagged one.
- **BELOW the surface is not a crossing either, and the shared `isBelowSurface`
  decides it** — not a bespoke test here. The clause above was once
  `level <= 1`, which bounded only the TOP: a `layer=-1` way passed, so through
  `bridgeDeckLines` → `addWater` it opened a 10 m passage corridor through a
  river bank and an agent could cross the water along something running under
  it. `tunnel=culvert` slipped through the old `tunnel === "yes"` test for the
  same reason.
  - **The asymmetry was the tell** (PR #315 review): `gateOpenings` vetoes a
    below-surface gate node and `canCorroborate` vetoes a below-surface way,
    while this third sibling rule in the same package did not. Three rules, two
    answers — now one definition.

Pinned against the real fixture in `bridge-crossing.corpus.test.ts` — 18 tagged,
exactly 14 selected — with counts chosen so each refuted draft would fail it
(8, 18 and 16 respectively).
