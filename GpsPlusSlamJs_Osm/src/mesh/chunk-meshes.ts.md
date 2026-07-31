# `mesh/chunk-meshes.ts` — batching geometry so it can be culled

## Purpose

Groups per-feature meshes into spatial chunks and merges within each, so the
renderer has something it can frustum-cull — and carries a per-vertex colour
buffer so a chunk stays one draw call while its features stay differently
coloured.

## Public API

- `CHUNK_SIZE_M` (920) — the grain, taken from the H3 res-8 ladder.
- `MeshChunk` — `{ key, mesh, colors? }`.
- `chunkKeyFor(point, sizeM?): string`
- `chunkMeshes(items, meshOf, positionOf, sizeM?, colourOf?): MeshChunk[]`
- `meshCentroidEnu(mesh): EnuPoint`

## Invariants & assumptions

- **Conservation is the whole claim.** Chunking changes _where_ triangles are
  batched and nothing else; a grouping bug that dropped geometry at a boundary
  would read as sparse OSM data rather than as a defect. Asserted directly.
- **It exists because one mesh cannot be culled in parts.** three frustum-culls
  per `Object3D`, so a merged 2.8 km city was all-or-nothing — which is what
  R4-16 saw as geometry kilometres away still being drawn.
- **A metric grid, not literal H3 cells** — a deviation from the plan, stated.
  The purpose is culling, not indexing: a chunk only needs to be a compact group
  with a bounding box, and keying on real cells would mean a projection back to
  lat/lng per building for an alignment nothing downstream reads. The size comes
  from the H3 ladder so the grain still matches the guidance.
- **`Math.floor`, not `Math.trunc`.** Truncation folds −10 and +10 into the same
  cell, doubling the four chunks around the origin — which is exactly where the
  user is.
- **`meshCentroidEnu` returns ENU north, not the render frame's `−z`.** Mixing
  the frames would scatter each layer into a _different_ set of chunks —
  self-consistent per layer, and therefore invisible.
- **An empty input produces NO chunks**, not one empty chunk: an empty
  `BufferGeometry` is still a draw call and a disposal obligation.
- **Deterministic.** Chunks come out in first-seen order and merge in input
  order, because the demo's e2e suite compares rendered frames.
- **Colour is flat per feature and lives on the CHUNK, not on `MeshData`.** A
  chunk is one draw call and must stay one, so a chunk holding a hundred
  buildings of a dozen classes cannot use a per-material colour. Attaching it
  here rather than threading it through `MeshBuilder` keeps it at the one seam
  where per-feature colour meets per-chunk batching.
- **No `colourOf` means no colour buffer** — bytes and a shader define bought for
  nothing.

## Examples

```ts
const buildings = chunkMeshes(
  volumes,
  (v) => v.mesh,
  (v) => meshCentroidEnu(v.mesh),
  undefined,
  (v) => buildingColour(tagsByKey.get(v.parentFeature ?? v.feature) ?? {}),
);
```

## Tests

`chunk-meshes.test.ts` — triangle conservation, nearby-together and
distant-apart grouping, the empty and degenerate cases, determinism, the key's
sign handling, the centroid's frame, and for colours: flat per feature, each
feature's colour on its own vertices, no buffer when uncoloured, and the buffer
sized to the merged vertex count.
