# `mesh/plates.ts`

## Purpose

Turns OSM ground areas — car parks, pitches, landuse, water — into flat filled
surfaces. The layer the feedback asked for as _"flache Platten quasi im 3D-Raum"_.

## Public API

- `isPlateArea(tags): boolean` — does this feature belong to this builder?
- `buildAreaPlates(features, { frame, groundHeightM? }): AreaPlate[]` — one entry
  per polygon, each with a `MeshData`. Skips everything that does not qualify.

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

## Tests

`plates.test.ts` — 13 examples. The classification rules, real triangles, flatness
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
