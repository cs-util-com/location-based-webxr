# mesh-distance.ts

**Purpose:** the sampled symmetric surface distance between two triangle meshes, the deviation the level-of-detail pass (`model-lod.ts`) picks its default level by and stores per saved level.

## Public API

- `surfaceDistance(PA, IA, PB, IB, samples = 20000, gridA = null)` returns `{ mean, max }` in model units: `samples` points by area on each mesh, each measured to the nearest point of the other. `max` estimates the Hausdorff distance from below. `gridA` is a `SurfaceGrid` of mesh A reused by a caller comparing many levels against one full mesh. Two empty meshes read `{ 0, 0 }`; one empty against a non-empty one reads `Infinity`.
- `SurfaceGrid(P, I)` with `nearest(x, y, z)`: a uniform grid of triangles, about two triangles a cell (each extent counted as at least 1 % of the largest, so a flat mesh gets finite cells; at most 256 cells an axis), searched in growing shells until no nearer triangle can lie outside the shell.
- `samplePoints(P, I, n, seed)`: `n` points uniform by area, xyz each.
- `pointTri2(px, py, pz, P, a, b, c)`: the squared distance from a point to a triangle (`a`, `b`, `c` offsets into `P`), by the closest-point regions.

## Invariants

- Seeded (mulberry32 with fixed seeds 1 and 2): the same meshes always give the same answer, so a dropped file always gets the same default level.
- `max` never exceeds the true largest distance; with 20 000 samples a side it reads within a few percent of it on the scanned models (spike findings).
- Positions and indices are any `ArrayLike<number>`; nothing is validated (an internal kernel: its caller passes indices it produced).

## Tests

- `mesh-distance.test.ts`: `pointTri2` in every region and, as a property, never farther than the nearest corner; zero for a mesh against itself and repeatable; a sphere lifted by h reads close to h and never above it; a reused grid gives the same answer; a flat mesh measured without the grid blowing up; an empty mesh reads infinitely far.
