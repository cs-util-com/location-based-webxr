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
- **The published frame is `(+x = east, +y = up, −z = NORTH)` — right-handed**,
  matching three.js and WebXR local-up spaces exactly. Buffers drop straight
  into a north-aligned scene with no transform.
  - **It was `+z = north` until 2026-07-29**, which is left-handed and rendered
    a north-aligned scene mirrored north/south. Buildings stay correct relative
    to each other, so it looked like a plausible city and read as a compass or
    heading bug somewhere else entirely. Changed on an owner decision from the
    PR 223 review; **semver MAJOR** for any consumer that was compensating.
  - **The reflection lives in `MeshBuilder` and only there.** Emitters keep
    working in ENU; `vertex()` negates z and nz, and `triangle()` reverses.
    Both halves are required and neither is meaningful alone: for a reflection
    `M` with `det(M) = -1`, `cross(Mu, Mv) = -M(u × v)`, so mirroring positions
    and normals alone would leave every triangle wound against its own normal —
    lit correctly and culled backwards.
  - **Central rather than per-emitter, deliberately.** The eleven emission sites
    do not express orientation uniformly: some compensate by index order
    (`extrude.ts` walls), others by choosing the corner order of `p, q, r, s`
    (`roof.ts` slopes, which then emit natural `(i0, i1, i2)`). "Delete the
    reversals" is therefore not a mechanical edit, whereas one reflection at the
    boundary cannot miss an emitter because it touches none of them.
  - **Why it shipped unnoticed:** every orientation test compared a mesh against
    ITSELF — winding against its own normals, normals against its own volume —
    and all of those hold equally well in a mirrored world. The demo could not
    catch it either: `building-view.ts` parks a free camera with no north
    reference. `mesh-orientation.test.ts` now has a block that pins the frame
    against the real world, which is the only test here that does.
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
