# `mesh/mesh-data.ts`

## Purpose

What a mesh IS — the buffer type and the builder that accumulates one.

## Public API

- `interface MeshData` — `positions`, `normals` (`Float32Array`), `indices`
  (`Uint32Array`), `triangleCount`, `forcedEars`
- `class MeshBuilder` — `vertex(x,y,z,nx,ny,nz)`, `triangle(a,b,c)`,
  `append(mesh)`, `build(forcedEars?)`

## Invariants & assumptions

- **Its own module to break a cycle.** `extrude.ts` needs the roof and `roof.ts`
  needs the builder; the repo's `check:cycles` gate caught it immediately. The
  split is also the right shape: this file says what a mesh is, the other two say
  how particular meshes are made.
- **Typed arrays, so results TRANSFER across a worker boundary** rather than
  being copied — §4.2 asks for this explicitly, and it matters at building
  counts.
- **Y is up**, matching the AR scene graph.
- **No vertex sharing.** Each wall quad gets its own four vertices so normals are
  flat. Buildings are all hard edges; shared vertices would mean either smeared
  shading or a second pass to undo it.
- `append` re-bases indices, so merging never produces an out-of-range index.

## Examples

```ts
const builder = new MeshBuilder();
const a = builder.vertex(0, 0, 0, 0, 1, 0);
const mesh = builder.build();
```

## Tests

Exercised through `buildings.test.ts` — wall and cap triangle counts, normal
directions, and merging with index re-basing.
