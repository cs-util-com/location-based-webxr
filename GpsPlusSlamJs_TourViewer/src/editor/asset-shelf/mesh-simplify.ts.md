# mesh-simplify.ts

**Purpose:** a progressive mesh simplifier for the model step's level-of-detail pass (`model-lod.ts`): quadric-error half-edge collapse, run once per primitive, from which every level is read as an index list into the original vertex buffer.

## Public API

- `weldVertices({ position, uv?, normal?, exact? }, indices, normalAngleDeg = 2)` returns `{ remap, count, indices, first }`: render vertices merged where position, texture coordinate and every `exact` attribute are bit-equal (-0 equals 0) and the normals differ by at most `normalAngleDeg`. `first[r]` is the first input vertex of welded vertex `r`, so a level over the welded vertices maps back to the input buffer. Throws a `RangeError` when an attribute does not have one whole entry a vertex (a weld would otherwise mix one vertex's values with the next one's).
- `remapAttribute(data, size, weld)`: one attribute over the welded vertices (the first input vertex wins).
- `buildProgressive({ positions, indices, attributes? }, { maxTurnDeg = 45, edgeWeight = 1, normals? })` returns a `Progressive`: the collapse order (`order`, `triDeath`, `wParent`, `wStep`), the live triangles after each step (`stepAlive`, non-increasing), the largest quadric error so far (`stepError`, non-decreasing), `triangleCount`, `minTriangles`, `diag`. `attributes` enter the error metric scaled by `weight`; `normals` enable the facing check.
- `stepsFor(prog, targetTris)`: the fewest steps whose level has at most `targetTris` triangles (the last step when none has).
- `levelTriangles(prog, steps)` and `levelIndices(prog, steps)`: the level after `steps` collapses; its triangles are a prefix of `prog.order`, its indices point into the original vertex buffer.

## Invariants

- A half-edge collapse moves a vertex onto an existing neighbour, so no level adds a vertex; a coarser level's triangles are a prefix of a finer one's.
- A vertex on a border or attribute seam moves only along it, priced by the border's edge constraints: a straight border thins out for free, a corner of an outline moves only at a cost. A vertex where more than two seam or border edges meet, and any non-manifold vertex, never moves. So at a small error an open patch keeps its outline and a texture seam stays where it was.
- A collapse is refused when a remaining triangle would turn by more than `maxTurnDeg`, degenerate, face away from its corners' shading normals, or break the link condition (the mesh stays manifold where it was).
- An open patch can collapse to nothing at the end of its order (`stepAlive` reaching 0); a caller that saves levels stops at the last step that leaves a triangle (`model-lod.ts`).
- Triangles degenerate from the start (two corners at one position) die at step -1 and are in no level.
- The metric is normalized to the bounding box diagonal; `stepError` is the square root of the quadric cost, a ranking, not a distance: the deviation in model units is measured by `mesh-distance.ts`.
- Pure and synchronous: typed arrays, no allocation per collapse. It runs in the optimizer's Worker.
- meshoptimizer (MIT) was the reference it was measured against; no code is translated from it.

## Examples

```ts
const prog = buildProgressive(
  { positions, indices, attributes: [{ data: uvs, size: 2, weight: 1 }] },
  { normals },
);
const quarter = levelIndices(prog, stepsFor(prog, prog.triangleCount / 4));
```

## Tests

- `mesh-simplify.test.ts`: the weld (near-equal normals merged, a hard edge and a different texture coordinate or colour kept apart); a flat square to about a tenth of its triangles at no cost, with its corners and outline kept; a bumpy sphere within 1 % of its diagonal at a quarter of its triangles; no face turned away from its normals; a tighter turn limit collapses less; a closed tetrahedron never collapses; level counts against the sequence; degenerate triangles dropped.
- `mesh-simplify.property.test.ts`: for random height fields and spheres, every level indexes existing vertices, forms no degenerate triangle, stays manifold (a closed mesh closed), and the counts fall monotonically with the steps while the error grows monotonically.
