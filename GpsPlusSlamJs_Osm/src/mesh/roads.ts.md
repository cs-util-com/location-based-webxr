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
