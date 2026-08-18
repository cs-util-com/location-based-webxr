# `src/mesh/roads.ts`

## Purpose

Road ribbons (W13, DEC-R2-12 / DEC-R2-13) — the hardest builder in round 2. One
merged surface per way, draped on terrain.

## Public API

- `roadWidthM(tags) → number` — drawn width in metres. **Never `NaN`, never 0.**
- `isRoad(feature) → boolean` — whether this builder owns the feature.
- `BuildRoadsOptions` — `{ frame, groundHeightM? }`, the same shape every other
  builder here takes.
- `RoadRibbon` — `{ feature, widthM, mesh }`.
- `buildRoads(features, options) → RoadRibbon[]` — in input order. Never throws;
  a degenerate way yields an empty mesh rather than `NaN` geometry.

## Invariants & assumptions

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
- **A `lanes` value that is not a positive integer is ignored.** `lanes=1;2` and
  `lanes=none` both occur.
- **Geometry is segment quads PLUS a disc at every vertex (DEC-R2-13).** Two
  quads meeting at an angle leave a wedge of bare ground on the outside of the
  turn. A disc of the road's own width centred on each vertex fills it **by
  construction, at any angle, with no special cases**. Its only cost is overlap,
  which is invisible because DEC-R2-13 already requires roads to be opaque.
  - Discs are placed at the END vertices too. A rounded cap costs the same eight
    triangles and stops a road ending in a hard edge across the carriageway.
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

## Examples

```ts
const ribbons = buildRoads(features, {
  frame: enuFrameAt(userPosition),
  groundHeightM: (p) => field.heightAt(p),
});
const merged = mergeMeshes(ribbons.map((r) => r.mesh));
```

## Tests

`roads.test.ts` — 18 tests.

- **`roadWidthM`** — the width tag wins (including `7 m`); lanes-derived width;
  the single-lane 4 m rule; per-class defaults; `service` at 4 m; flat path
  widths; an unknown class gets a finite documented default; a malformed `lanes`
  is ignored.
- **`isRoad`** — accepts a highway way; rejects nodes, untagged ways, tunnels,
  covered ways and highway areas.
- **`buildRoads`** — a straight way is covered across its width and not beyond
  it; **no gap at a right-angle corner**; **no hole at a three-way junction**;
  per-vertex ground sampling; degenerate ways stay finite; all vertex data finite
  on a real-ish polyline.

The junction tests assert **coverage**, not triangle counts — a count passes on
geometry full of holes. The helper does a plan-view point-in-triangle test and
explicitly rejects degenerate triangles, so the "not covered" assertions cannot
silently become no-ops. Mutation-checked: removing the discs fails
"leaves NO GAP at a right-angle corner" and nothing else.

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
