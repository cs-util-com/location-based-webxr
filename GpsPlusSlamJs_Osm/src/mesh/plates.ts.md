# `mesh/plates.ts`

## Purpose

Turns OSM ground areas — car parks, pitches, landuse, water — into flat filled
surfaces. The layer the feedback asked for as _"flache Platten quasi im 3D-Raum"_.

## Public API

- `isPlateArea(tags): boolean` — does this feature belong to this builder?
- `buildAreaPlates(features, { frame, groundHeightM?, clipTo? }): AreaPlate[]` —
  one entry per polygon, each with a `MeshData`. Skips everything that does not
  qualify.
  - **`clipTo` is optional but strongly recommended**, and omitting it is how a
    caller opts into an unbounded quadratic. See the complexity note below.

## Invariants & assumptions

- **Two exclusions, both to stop two builders drawing the same thing.**
  `building`/`building:part` belong to `buildings.ts` (a plate over a footprint
  sits inside the extruded volume and z-fights with its floor), and anything with
  `highway` belongs to the road builder. The second is the way-449879297 rule seen
  from the other side: a closed `highway` way is a LineString, so filling it would
  put a blob where a ribbon belongs.
- **Terrain is sampled PER VERTEX**, unlike a building. A building is a rigid box
  and takes one sample at the minimum under its footprint (DEC-R2-19); a plate is
  a surface, so a 30 m car park sampled once would cut into the ground at one end
  and float at the other — exactly the artefact the building change removed.
- **Normals point straight up, and are not computed.** A plate is horizontal by
  construction, so a per-face normal would differ only by the noise in the terrain
  samples — which would make a flat car park look faceted.
- **A degenerate polygon is skipped, never emitted as an empty mesh.** Real OSM
  contains collapsed ways; an empty mesh in the list is a draw call for no pixels
  plus a feature id that appears to have geometry.
- **`forcedEars` is forwarded, not dropped.** It is the triangulator's honesty
  flag, in the same family as `roofIsApproximate`. Swallowing it would make the
  count under-report how much of the real planet is malformed.
- **No `three`.** `Float32Array` out, like every builder here (plan §4.2), which is
  also what lets the whole build run in a Worker and transfer rather than copy.

## Examples

```ts
const plates = buildAreaPlates(features, { frame, groundHeightM });
const merged = mergeMeshes(plates.map((p) => p.mesh)); // one draw call
```

## Complexity — why `clipTo` exists

`triangulate` is ear clipping, which is **O(n²)** in ring size, while an OSM
area's size is unbounded. So an area far larger than the view costs
quadratically to draw geometry that is then off screen.

Measured 2026-07-31 (devbox-win11) on `building-block`, one ordinary Cologne
city block. It contains a 316-member administrative boundary relation — the same
one that made ring stitching quadratic, arriving here through a third path:

- its largest polygon is 25 001 points → `triangulate` **2 657.7 ms**
- a 4 867-point one → 111.8 ms, i.e. points ×5.1 for time ×23.8
- `buildAreaPlates` overall: **3 987 ms → 4.00 ms (−99.9 %)** once clipped to the
  demo's rendered extent (1400 m half-width); `park` and `street-corner` are
  unchanged within noise, having no such relation.
- Plate COUNT drops 14 → 9 on that fixture, because five polygons of the
  boundary relation lie entirely outside the rendered area. That is the clip
  working, not geometry being lost.

Clipping first is the same principle `h3-feature-index` applies before covering,
for the same reason: bound the input, because the algorithm downstream cannot
bound itself.

## Tests

`plates.test.ts` — 15 examples. The classification rules, real triangles, flatness
on level ground, per-vertex draping on a slope, holes preserved, degenerate input
survived, and upward normals.

Two of them exist because the synthetic squares were **not enough**: one runs the
builder over the real captured `park.json` fixture (Volksgarten, 11 plates), and
one checks the plates survive `mergeMeshes`. The demo drew nothing while every
synthetic test passed, which is the general lesson — a builder tested only on
geometry the test author constructed is tested against their own assumptions about
the data.

**Known gap:** the demo's e2e asserts plates are BUILT and counted, not that they
appear as pixels. See `2026-07-29-2354-osm-demo-feedback-round-2-plan.md` §7.

Two more added with the 2026-07-31 clip: one pins that areas inside the box
survive while those entirely outside are dropped, and one is a wall-clock budget
(500 ms against a real cost of ~4 ms, versus 3 987 ms unclipped) so the clip
silently ceasing to apply fails at the gate. The budget is absolute rather than a
ratio, and deliberately does not time the unclipped path — asserting that would
make the test itself take four seconds.
