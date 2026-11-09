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
- `RoadRibbon` — `{ feature, widthM, mesh }`.
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
  `pedestrian`/`bridleway` 2 m, `cycleway` 3 m. A footway has no lanes, and
  multiplying a fictional lane count by a lane width is arithmetic dressed up as
  data.
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
    (r1164 pinned in `testdata/sites/site-roads.test.ts`). r1161's counts
    were the same at mitre limits 1.5 to 4 and about 9 % higher at 1 (every
    join bevelled).
  - **What M4a's spec asked for, and how the strip answers it**: the spec was
    written for O3's first answer, dropping the disc on near-straight vertices
    (`straightDeg`, a notch limit); the owner then chose the mitre strip, which
    has no such parameters because it leaves no notch to limit. O3's kerb lines
    and their `kerbTaperM` are NOT ported: plan §3 left the kerb in the lab.
- **Classes are stacked by a lift, not by draw order (M4a class order).** A way
  of rank r sits `rankStepM * (r + 0.4 * f)` above the ground at its discs and
  half a step higher along its strip, where f in [0, 1) is a hash (FNV-1a) of
  the feature key, so two ways of one class at a junction never share a depth.
  So a carriageway covers a footway that crosses it, and a way's own discs sit
  under its strip rather than poking through at a junction. At the default 5 mm
  step the highest road is 3.9 steps = 1.95 cm up, under the 4 cm rung
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
24-bit depth buffer. Percentages are of the overlap's pixels.

- **The 0 mm column (main before M4a: every road coplanar) was added in r1164**
  so "better than before" is measured: on the real GPU 8-66 % of the overlap
  fights in every view (36 % at 41 m, 19 % at 226 m, 66 % in the editor at
  300 m). On SwiftShader two views read 0 at 0 mm (globe landing 100 m, editor
  300 m): the coplanar tie resolves the same way every frame there, so those
  views cannot show fighting at all, which is not a clean gap.
- **(a) Geometric gaps (what the builder does).** On the real GPU a gap of
  1.5 mm or more is clean in every view except 570 m, where 3 of 96 pixels
  differ at every gap up to 20 mm (17 mm included), i.e. that view's edge
  noise. The worst figure is the editor camera 300 m up at 0.5 mm: **31.9 %**
  (65.8 % at 0 mm, 2.2 % at 1 mm). On SwiftShader even 5 mm shows through 37 %
  at 226 m and 10 % at 570 m.
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
- **So neither candidate is clean everywhere, and the step stays 5 mm until
  the owner decides.** At 5 mm the strip-to-strip gap between classes (at
  least 0.6 step = 3 mm) is clean on the real GPU in every view measured; an
  END disc of a higher class over a lower class's strip can be 0.1 step
  (0.5 mm) apart and fights up to 31.9 % (editor 300 m), 19.3 % (globe 200 m)
  and 12.6 % (226 m); two ways of ONE class tie within 0.4 step and fight
  where their colours differ (a `surface` tag). Since r1164 discs exist
  only at ends and fallbacks, so the 0.1-step case is rarer than in r1161.
  SwiftShader fights at 5 mm at 226 m, 570 m and the deep globe view. Phone
  GPUs were not measured. **The value that reverses it:** a 17 mm step (class
  gap 10.2 mm, end-disc gap 1.7 mm) is clean in every GPU view, and on
  SwiftShader everywhere but the deep globe view (16.4 %); clean there too
  needs a class gap of 17 mm, a 28 mm step. 17 mm puts the top road 6.6 cm up,
  so OsmDemo's 4 cm ladder would widen to 8 cm (kept as a scratchpad patch,
  not committed).
- **Real scenes did not separate the variants (r1164).** OsmDemo's Heidelberg
  corpus (boot view 226 m, a close view) and the Tour Editor globe at 300 m,
  shot with main, r1161, r1164 and the 17 mm variant, a camera nudge against
  a re-shot floor: every nudge count sat at its own floor (within about 60
  of 1.3 million pixels), and the variants differed less than the floor moved
  between runs. At those distances roads are a few pixels wide and their
  overlaps a handful, under the method's noise. The two Schlossberg views
  (a residential street ending on a service road, on the castle hill) put the
  camera behind the hill and show no roads, so they are no evidence either
  way. The spike above is the quantitative evidence; the decision is open in
  the M4a report.

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
    way's disc under its own strip; every lift in [0, 2 cm); a zero step puts
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
