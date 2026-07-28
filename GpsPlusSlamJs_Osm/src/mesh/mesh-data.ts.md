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
- **The frame is `(+x = east, +y = up, +z = NORTH)`, which is LEFT-handed.**
  "Y is up, matching the AR scene graph" is only half of it, and the missing
  half mirrors the city.
  - three.js and WebXR local-up spaces put north at **−z**. A consumer that
    aligns this mesh to true north the ordinary way therefore gets the block
    flipped north/south — and because buildings stay correct _relative to each
    other_, it looks like a plausible city and reads as a compass/heading bug.
  - `extrude.ts` reverses every winding to compensate for the handedness flip.
    That fixes back-face culling, not the frame.
  - The demo cannot catch it: `building-view.ts` parks a free camera with no
    north reference, so mirrored and correct are indistinguishable there.
  - **Open question (raised in the PR 223 review, not yet decided):** emit
    `-p.y` for z in `extrude.ts` instead, which would make the frame
    right-handed and let the winding reversals go away — a behaviour change for
    any existing consumer, hence documented rather than done unilaterally. Until
    then the convention is stated on the exported `positions` field, which is
    where a consumer actually reads it.
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
