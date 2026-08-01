# `src/cell-bevel.ts`

## Purpose

Per-corner normals that make a flat affordance hexagon shade as though its rim
were bevelled (DEC-S2), so a specular highlight sweeps across each tile as the
camera orbits.

## Public API

- `bevelNormals(corners, strength = BEVEL_STRENGTH): number[]` — a flat
  `[x, y, z, …]` list, one unit normal per corner, in the order given.
- `BEVEL_STRENGTH` — the default lean, `0.45`.

## Invariants & assumptions

- **It is a lie, and the bound is the point.** The tiles stay flat; real
  extrusion would be ~3× the vertices on up to 2 989 cells rebuilt every publish
  (DEC-S2 weighed and rejected it). Setting `strength` to `0` returns exactly the
  old flat surface, which is what makes the whole thing reviewable as one number
  rather than as a revert.
- **NO NET TILT — the leans cancel around the ring.** This is the assertion to
  keep if any other is dropped. Every vertex of a cell is a rim corner (the fan
  pivots on corner 0; there is no centre vertex), so nothing holds the middle
  flat by construction. If the leans did not cancel, the hexagon would shade as a
  **sloped** tile — a picture that lies about the ground in a view whose whole
  job is showing scores on it.
- **Every normal keeps `y > 0.5`** — a shoulder, not a wall. A normal tipped past
  horizontal lights the tile from underneath and reads as a hole.
- **Height is deliberately ignored.** Cells sit on terrain and their corners are
  not coplanar, but the ground plane beneath already shades that relief; letting
  the cell normals follow it would apply the same terrain twice. The lean comes
  from the horizontal offset alone, which also makes a cell's normals independent
  of how much relief it happens to straddle.
- **Degenerate inputs return up-normals rather than `NaN`.** Cells clipped at the
  drawn extent can arrive with fewer than three corners, and a corner sitting
  exactly on the centroid has no outward direction. A `NaN` normal silently drops
  the triangle instead of reporting anything.
- **Where it breaks down, accepted when DEC-S2 was taken:** at grazing angles and
  at arm's length in AR, a flat tile pretending to have a rolled edge reads as odd
  shading rather than as an edge.

## Examples

```ts
const normals = bevelNormals(cellCorners);
// …written into the cell mesh's `normals` buffer at this cell's vertex offset.
```

Consumed by `cell-mesh.ts`, which owns the ragged per-cell layout, and read by
the `MeshStandardMaterial` in `building-view.ts` — the normals do nothing until
the grid material is lit, which it has been since DEC-S1.

## Tests

`cell-bevel.test.ts` — unit normals, outward lean, `y > 0.5`, the cancellation
property, `strength: 0` returning flat, monotonicity in `strength`, the default
being inside `(0, 1)`, degenerate corner counts, a corner on the centroid, and
independence from height.
