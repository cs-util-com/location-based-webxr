# `mesh/mesh-data.ts`

## Purpose

What a mesh IS — the buffer type and the builder that accumulates one.

## Public API

- `interface MeshData` — `positions`, `normals` (`Float32Array`), `indices`
  (`Uint32Array`), `triangleCount`, `forcedEars`, and the optional
  `colours` (`Float32Array | undefined`)
- `class MeshBuilder` — `vertex(x,y,z,nx,ny,nz)`, `triangle(a,b,c)`,
  `paint(0xrrggbb)`, `pushTransform({rotateX?, rotateY?, x?, y?, z?})`,
  `popTransform()`, `append(mesh)`, `build(forcedEars?)`

## Invariants & assumptions

- **Its own module to break a cycle.** `extrude.ts` needs the roof and `roof.ts`
  needs the builder; the repo's `check:cycles` gate caught it immediately. The
  split is also the right shape: this file says what a mesh is, the other two say
  how particular meshes are made.
- **The accumulators are GROWABLE TYPED ARRAYS, doubled in place** — not
  `number[]` with `push`. This is the hottest data structure in the package and
  the shape is a measured decision, not a style one.
  - **What it replaced.** `px`, `nx`, `idx` and `cx` were plain `number[]`, one
    `push` per element, converted in `build()` by `new Float32Array(this.px)`.
    Every float therefore made the trip **float32 → boxed double → float32**,
    and a merge of one chunk's buildings ran ~5.6 million individual `push`
    calls.
  - **Why the old shape was invisible.** Every instrument in this package
    measures a GEOMETRY algorithm — ear clipping, hole bridging, polygon cover,
    spatial queries. An accumulator is a cost _underneath_ all of them, and it
    only shows up in a profile taken over the whole composition. A `--cpu-prof`
    of the demo's `buildMesh` at a 36 144-feature working set ranked it first:
    `build` **11.3 %**, `append` **6.5 %**, `vertex` **2.9 %** of sampled CPU —
    **20.6 %** in one class, against 8.9 % for `clipEars`, plus an unattributed
    share of the 7.7 % spent in GC.
  - **Why the new shape is fast.** `vertex` writes three floats into a
    pre-sized buffer behind one length comparison. `append` is the bigger win:
    both sides are already `Float32Array`, so positions, normals and colours are
    whole-array `set()` copies — a memcpy instead of an element-by-element round
    trip through boxed doubles. Only the indices are still walked, because each
    one is re-based onto this builder's vertex numbering. `build()` is a
    `slice(0, cursor)` per buffer: one copy, no conversion.
  - **Capacity doubles rather than growing to fit**, which is what keeps `n`
    appends `O(n)` amortised. `INITIAL_CAPACITY` is 96 floats — 32 vertices, one
    `box` — so the thousands of transient POI meshes never grow at all and none
    of them over-allocates.
  - **Measured, devbox-win11** (Win 11 Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz,
    Node 24.14.1), medians of 9 against the built `dist`:
    - `mergeMeshes` (1 097 meshes, 52 712 vertices) — **5.55 → 1.91 ms, −66 %**
    - `vertex + triangle` (200 000 vertices) — **19.58 → 8.61 ms, −56 %**
    - `vertex + paint` (200 000 vertices) — **32.65 → 20.60 ms, −37 %**
    - `chunkMeshes` over a k=4 working set — buildings **183.2 → 100.1 ms**,
      roads **66.1 → 32.1 ms**, plates **7.5 → 5.1 ms**
    - the demo's whole `buildMesh` at that working set — **1 564.1 → 1 185.2 ms,
      −24.2 %**
  - **Output is byte-identical**, and that was checked rather than assumed: the
    element sums and lengths of every buffer match to the last digit before and
    after, for both a merged mesh and a painted emitted one. The float32 →
    double → float32 round trip the old code made was exact, so removing it
    changes no value.
  - **The new failure mode is a cursor/capacity disagreement**, which the old
    design could not have — `build()` handing back spare capacity as real
    vertices would render geometry collapsed to the origin. Every case in the
    `MeshBuilder buffer growth` block crosses at least one growth boundary,
    because no other test in the suite builds a mesh past 32 vertices.
- **`append` REJECTS a mesh whose normals do not match its positions.**
  Positions and normals share one write cursor, so a mismatch would misalign
  every vertex after the join. The old element-wise loop wrote `NaN` normals
  instead — equally wrong and harder to trace back to here.
- **And a mesh whose colours do not match its positions, for the same reason**
  (PR #339 review). `cxLen` and `pxLen` are independent write cursors, so a
  mismatched colours array desynchronises them permanently: every later vertex
  writes its RGB at the wrong offset, and three.js reads the short/long buffer
  as a plausible attribute — the wrong faces painted, no error anywhere.
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
- **A part can be ROTATED as well as placed (§4, DEC-R6-26).**
  `pushTransform`/`popTransform` are a stack that `vertex` applies, mirroring the
  `Matrix4` the house-style prototype composes in `Parts.push` — 13 of its 52
  builders use a rotation, and the tilts are structural (an untilted information
  board is a fence panel).
  - **At the BUILDER rather than on each primitive**, so every primitive gains
    rotation at once with no signature changes and no second copy of the
    arithmetic. It is also the same shape as the source, which keeps ports
    mechanical.
  - **ROTATE, THEN TRANSLATE.** The other order swings a part around the MODEL
    origin instead of its own, which misplaces a tilted part rather than
    mis-orienting it — so it looks deliberate.
  - **Normals rotate but never translate.** A direction that had an offset added
    would point at wherever the part happens to sit, shading every tilted part
    as though lit from the origin.
  - **`rotateX` is RIGHT-HANDED**, matching three and therefore the source's
    `rx` values: a quarter turn about `+x` sends ENU `+z` to `−y`. The first
    version of the test asserted the opposite sign; porting against the wrong
    one tilts every board the wrong way, which reads as a modelling choice.
  - **The identity path is bit-exact and that is tested, not assumed.** With an
    empty stack `vertex` takes the path it always did, so buildings, roads,
    plates and slabs are unchanged to the last bit — "almost identical" is not
    good enough for buffers that pixel assertions compare against.
- **Per-face colour is OPT-IN and costs nothing when unused (§4, DEC-R6-11).**
  `paint(0xrrggbb)` sets the colour every subsequent `vertex` carries; until it
  is called, no colour array is allocated at all and `build()` returns
  `colours: undefined`. That matters because buildings, roads, plates and region
  slabs all build through here on the chunk-meshing hot path and none of them
  paint per face — they are coloured per feature by an array the consumer builds.
  - **Stateful rather than a seventh argument to `vertex`**, because the
    emitters paint per FACE: `box` writes four vertices per face through one
    helper, and threading a colour through every primitive's signature would
    touch code with no interest in colour.
  - **Values MULTIPLY the material colour** (three's `vertexColors`), so white
    is the identity — an unpainted vertex in a partly-painted mesh renders as
    the model's own `colour`. This is what lets a model be painted one face at a
    time rather than all at once, which is how the §4 rebuild proceeds.
  - **`paint` backfills earlier vertices WHITE, not with the new colour**, so
    painting from the third face does not retro-paint the first two.
  - **`append` is where the three parallel arrays can desynchronise**, and both
    directions are handled: a painted mesh joining an unpainted one backfills the
    target, and an unpainted mesh joining a painted one contributes white. The
    colour bookkeeping runs BEFORE the positions are pushed — doing it after
    makes the backfill count the incoming vertices and leaves the array too long.
    A misaligned colour buffer paints the wrong faces rather than throwing, so
    both directions are pinned by tests.

## Examples

```ts
const builder = new MeshBuilder();
const a = builder.vertex(0, 0, 0, 0, 1, 0);
const mesh = builder.build();
```

## Tests

Exercised through `buildings.test.ts` — wall and cap triangle counts, normal
directions, and merging with index re-basing.

`mesh-data.bench.ts` is the cost instrument for the accumulator, benching the
merge path (`mergeMeshes` over every building volume of a real site) and the
emitter path (`vertex`/`triangle`, painted and unpainted) separately, because
the two have different fixes and one number would hide which moved.

`mesh-data.test.ts` covers the colour half directly: that an unpainted mesh
allocates no array (the cost guard, and the reason it is the first test), that
painting yields one RGB triple per vertex, that two faces can differ, that
unpainted vertices are white, that the packed hex decodes in the right channel
order, and that `append` keeps colours aligned in BOTH mixed directions plus the
unpainted/unpainted case.

Its `MeshBuilder buffer growth` block covers the typed-array accumulators: that
`build` returns the written prefix rather than the reserved capacity, that
values survive repeated doublings, that the index buffer grows independently of
the vertex buffer, that colours stay aligned across a growth boundary and that a
late `paint` backfills white only to the written prefix, that a mesh larger than
the target's whole capacity appends intact, that indices are re-based by the
vertex cursor rather than the buffer length, and that mismatched normals and
mismatched colours are rejected.
