# `anchor-visibility.ts`

## Purpose

Answers one question for a content anchor: **is any part of its subtree in
view?** Content that has to move to a corrected pose re-places only while none
of it is in view, so it never visibly jumps. The predicate is conservative by
design: a false "out" makes content jump on screen (the one failure it exists
to prevent); a false "in" only delays a re-placement.

It is a pure geometry module: no store, no dispatch, no timers. The caller owns
when to ask and what to do with the answer.

## Public API

Deep import only (`gps-plus-slam-app-framework/ar/anchor-visibility`), not
through the `ar` barrel.

- **Constants**
  - `ANCHOR_VIEW_MARGIN_DEG = 5`: the recommended side margin in degrees.
  - `ANCHOR_SPHERE_CAP = 32`: the most spheres a cache keeps per anchor,
    merged down to it nearest first. Skinned, morphed and constant-size
    sprite entries are never merged, so with more than 31 of them the cache
    holds them all plus one merged sphere: the cap is a target, not a hard
    limit.
  - `ANCHOR_BOUNDS_REFRESH_MS = 1000`: the age after which a cache that keeps
    answering "in" asks for a fresh traversal.
- **Hints on the subtree** (read live, from the object or any ancestor up to
  the anchor; `TypeError` on a non-`Object3D`)
  - `ignoreForAnchorVisibility(object)`: the object and its subtree never count
    (an edge hint the camera draws, a helper).
  - `mergeForAnchorBounds(root)`: the subtree is bounded by one sphere in the
    root's frame, built once and kept across fresh traversals until
    `markAnchorBoundsChanged`. For a loaded model with many parts and no inner
    motion. Constant-screen-size sprites under it stay their own entries.
    The anchor itself may be the root: its sphere then follows the target
    pose (`atLocal`) like any other entry.
    A merge root is one entry; when the cap merges it with other entries, the
    merged sphere no longer follows the root either (see below).
- **Views, filled once per frame**
  - `createAnchorView(): AnchorView`: an empty, reusable view.
  - `updateAnchorView(view, camera, xr?): AnchorView`: while `xr.isPresenting`,
    one slot per XR sub-camera (its world pose from
    `camera.parent.matrixWorld * sub.matrix`, its projection and its own layer
    mask); otherwise the user camera alone. Three sets the sub-cameras' matrix
    and projection before the frame callback runs, so calling this inside the
    animation loop reads the current frame (pinned by a test that drives a real
    `WebXRManager`). The view keeps one frustum per anchor parent, built on
    its first test in the frame; after moving a parent between two tests of
    one frame, call `updateAnchorView` again.
  - `XrCameraSource`: the minimal shape it reads (`isPresenting`,
    `getCamera().cameras`); a `WebXRManager` satisfies it.
- **Bounds cache, one per anchor**
  - `createAnchorBoundsCache(): AnchorBoundsCache`. A cache belongs to the
    anchor it was first built for; testing another anchor with it rebuilds it
    for that one.
  - `markAnchorBoundsChanged(cache)`: the subtree's structure changed (added,
    removed or swapped parts, a merge root's inner layout); the next test
    rebuilds, and the kept bind data (below) is dropped.
  - `anchorBoundsNeedRefresh(cache, nowMs): boolean`: true when the cache is
    invalid or older than `ANCHOR_BOUNDS_REFRESH_MS`. A caller whose anchor
    keeps answering "in" while it waits runs its next test with
    `fresh: true` when this is true, so a stale "in" (a moved instance, an
    unannounced change) cannot hold a re-placement back for more than about a
    second. `RangeError` on a non-finite `nowMs`.
- **The test**
  - `isAnchorInView(view, anchor, options): boolean`
    - `options.marginDeg` in [0, 90), else `RangeError`. The frustum's side
      planes widen by this angle; near and far stay.
    - `options.cache`: from `createAnchorBoundsCache`, else `TypeError`.
    - `options.atLocal?: Matrix4`: test the subtree as if the anchor's local
      matrix were this one (the target pose), else `TypeError`. Default: the
      anchor's current local matrix.
    - `options.fresh?: boolean`: traverse now and replace the cache before
      testing (a confirmation before acting, or a refresh).
    - `options.nowMs?: number`: stamped on a cache build (default
      `performance.now()`); `RangeError` when given and not finite.
    - `options.counters?: AnchorVisibilityCounters`: incremented
      `sphereTests` (sphere-frustum tests) and `traversals` (cache builds).
    - Returns `false` for a view with no slots and for an anchor with nothing
      drawable.

## Invariants and assumptions

- **Parent frame.** The test runs in the anchor's parent frame: each view's
  frustum is built from `inv(parent.matrixWorld) * worldFromView`, and the
  subtree's spheres are placed by the anchor's local matrix (or `atLocal`). A
  rigid move of everything above the parent, camera included, cannot change the
  answer (a property test).
- **World matrices are read as they are.** Three refreshes them when it
  renders; a cache build refreshes the subtree's own (`updateWorldMatrix`).
- **What is read live on every test:** `visible` and the ignore hint (by
  climbing to the anchor; a node detached from the anchor no longer counts),
  each renderable's world matrix relative to the anchor (so a part that moves
  or turns about itself needs no rebuild), sprite scale and center, the
  bones of skinned meshes, and the morph influences of every morphed
  renderable. Entries the sphere cap merged together are the exception: a
  merged sphere is fixed in the anchor frame at the build, so its members'
  own motion is followed only from the next rebuild (at most the 1 s
  refresh). A merge root follows its root only while it stays its own entry.
- **What needs a rebuild:** added or removed parts, swapped geometry, moved
  instances of an instanced or batched mesh, and any inner change under a
  merge root, and the motion of parts the cap merged. `markAnchorBoundsChanged`
  or the 1 s refresh covers them.
- **Kept bind data.** The vertex walk of a skinned or morphed part (tens of
  ms for a 20k-vertex rig with 50 blend shapes) is kept across fresh
  traversals, per renderable and per kind (skin, morph: a skinned mesh
  without a skinned bound falls back to its morph bound, and both are kept).
  It is keyed by the geometry's `id`, `morphTargetsRelative` and, per read
  attribute, its `id` (for interleaved data the shared buffer's `uuid`, the
  offset and item size) and version (for interleaved data the shared
  buffer's), and for a skinned part by the bind-to-bone matrices compared by
  value. The geometry's `id` is there because three keys its morph texture
  on the geometry and ignores `needsUpdate` on morph attributes: a geometry
  swapped in around the same attributes after an in-place edit draws the
  edited shape although every attribute key matches. The key holds no
  geometry or attribute, so a replaced one is not kept in memory.
  Replacing or editing an attribute with `needsUpdate`, swapping the
  geometry or rebinding recomputes it. **Contract:** after any in-place edit
  of a skinned or morphed part, set `needsUpdate` on the edited attribute or
  call `markAnchorBoundsChanged`, also where three itself would not need it
  (see Known limits).
- **Sphere per renderable.**
  - Mesh, Points, Line: rotation-invariant about the renderable's origin,
    radius `|c| + r` of the geometry's bounding sphere, scaled by the largest
    stretch of its matrix.
  - Morphed Mesh, Points, Line (position morph targets): three's geometry
    bounding sphere covers each target alone at influence 1, not several
    targets at once nor an influence outside [0, 1]. These are bounded by the
    largest base vertex distance plus `sum_k |influence_k| * reach_k` (reach_k
    the largest displacement of target k; for absolute targets, the largest
    distance from the base vertex), with the influences read live on every
    test. They are never merged, so a merged sphere cannot freeze them.
  - InstancedMesh: recomputed on every build (the instance spread can sit
    anywhere relative to the origin): a box around each instance's centre
    widened by the geometry radius times the instance matrix's largest
    stretch, then the farthest such reach from the box centre. Three's own
    instanced sphere scales by the largest column, which a sheared instance
    matrix exceeds.
  - BatchedMesh: three's object bounding sphere, radius times sqrt(3). Three
    bounds each instance by its largest column; the spectral norm is at most
    the Frobenius norm, at most sqrt(3) times the largest column, so the
    widened sphere covers every instance sphere at its true stretch, sheared
    ones included.
    Per-instance morph influences are not followed (see Known limits).
  - Sprite: centred on its world position, radius
    `hypot(sx * (0.5 + |cx - 0.5|), sy * (0.5 + |cy - 0.5|))` from the world
    scale, so a non-default `center` is covered. A `sizeAttenuation: false`
    sprite adds its angular size times the eye distance per perspective view
    (and the plain scale per orthographic view). The angular size assumes an
    unscaled camera chain (a camera or rig with scale 1).
  - CSS3D object: a point at its origin (see Known limits).
  - SkinnedMesh: its sphere is never cached (its bind data is). One sphere around the balls
    `B(bonePos_i, stretch(boneWorld_i) * D_i)` of the bones that carry weight,
    where `D_i` is the largest bone-local distance of a vertex weighted to bone
    i plus `morphScale_i * sum_k |influence_k| * morphReach_ik`; weight sums in
    `[min, max]` scale it about the origin of `matrixWorld * bindMatrixInverse`,
    which is then applied. Assumes non-negative weights (as glTF requires); a
    negative weight is clamped to 0. A weight on a bone index outside the
    skeleton adds nothing to the weight sum, as it moves no vertex. A skinned
    mesh with no skeleton, or with no positive weight, is still drawn, so it
    is bounded as a plain mesh instead. A bound skinned mesh missing
    `skinIndex` or `skinWeight` is still skinned by three, from the generic
    vertex attribute value at that location (which another program may have
    set, to 1 for a default colour, say), so its weights and bones are
    unknown: it is unbounded and counts as in view wherever it is, while it
    is counted, and is never merged.
- **Stretch.** The largest scale of a matrix is bounded by the square root of
  the Gershgorin bound of its Gram matrix, an upper bound on the spectral norm
  that stays safe under shear (`getMaxScaleOnAxis` underestimates it there).
- **Margin.** Only the x/y rows of the projection change, via the side
  tangents, so near, far and the depth convention stay. A widened side angle
  is clamped at 89.5 deg, and a side already past that stays as it is, so a
  larger margin is never narrower. Orthographic and skewed projections are not widened.
- **Layers.** A sphere counts for a view only when its layer mask meets the
  view's; a merged sphere carries the OR of its members that are counted.
- **Cost.** A cached test does at most `ANCHOR_SPHERE_CAP` sphere tests per
  view (plus one per never-merged entry past the cap), plus the bone pass of
  each skinned part. A fresh traversal reuses the kept bind data. A cache build is linear in
  the subtree, plus the merge, which is O(n^2) time and O(n) memory in the
  number of renderables above the cap: each cluster keeps its nearest
  neighbour, and a cluster whose neighbour merged is only marked stale and
  rescanned when it is picked, so each merge costs amortized O(n) however
  many clusters shared that neighbour: in 3-D a point is the nearest
  neighbour of a bounded number of points, so a merge leaves O(1) stale
  clusters, and coincident centres keep the recorded distance exact (zero),
  so a stale pick is rescanned once and taken. Coincident centres (the parts of a model
  whose meshes are flat children with baked positions, each bounded about
  its own origin) are the case this matters for: with an eager rescan of
  every such cluster per merge the build was O(n^3), about 30x the grid case
  for 400 parts and about 2 s for 1000. A large flat subtree should still use
  `mergeForAnchorBounds`.

## Parameters

Each value below was chosen, not swept; the tests pin behaviour at the
stated value and the property tests hold for any value (they test safety,
not tightness).

- **Side margin, 5 deg** (`ANCHOR_VIEW_MARGIN_DEG`). Covers what a sphere
  bound does not see: pose prediction between the test and the frame, a
  `Points` sprite's pixel size, and the edge of the camera image beyond the
  projection. Not swept: the right value depends on device motion during a
  frame and needs a phone measurement. A larger margin only delays
  re-placement.
- **Sphere cap, 32** (`ANCHOR_SPHERE_CAP`). Bounds the per-frame cost of a
  cached test at 64 sphere tests for two views (more only with more than 31
  never-merged entries). Not swept: tightness against
  the cap trades only delay, never safety.
- **Merge rule, nearest centres first.** Greedy: the two clusters whose
  centres are nearest merge into the smallest sphere around both; each cluster
  keeps its nearest alive neighbour; when that neighbour merged, the
  cluster is rescanned the next time it is picked as the closest. Skinned
  parts, morphed parts, constant-screen-size sprites and unbounded parts are
  never merged but count toward the cap. Not compared against other rules.
- **Refresh age, 1000 ms** (`ANCHOR_BOUNDS_REFRESH_MS`). How long a stale "in"
  can hold a re-placement back. Not swept.
- **Side angle clamp, 89.5 deg.** Keeps a widened tangent finite.

## Known limits

- Inner motion under a merge root is not followed until
  `markAnchorBoundsChanged` (documented on `mergeForAnchorBounds`).
- `Points` pixel size is not bounded; the margin covers small points.
- Per-instance morph influences of an `InstancedMesh` (`setMorphAt`) are not
  followed; the instanced sphere uses the base geometry.
- A vertex shader that displaces vertices beyond the geometry's bounds (wind,
  billboards in a shader) is not seen; set an enlarged `geometry.boundingSphere`
  on such a geometry (read here as by three's own culling) or opt it out.
- A CSS3D object counts as the point at its origin, not its element's
  rectangle: a wide element can be in view while its origin is out.
  Ignore it, or place a fully transparent proxy mesh of its size under
  it (it must stay `visible` to count).
- Kept bind data is not versioned beyond the attributes' own versions, and
  three uploads some in-place edits that bump no version: an edit before
  the part's first render, morph targets rebuilt after
  `geometry.dispose()` (where `needsUpdate` changes nothing for three), and
  `SkinnedMesh.normalizeSkinWeights()` before the part's first render. A
  fresh traversal keeps the old, possibly too small bound for such an edit.
  Set `needsUpdate` on the edited attribute or call `markAnchorBoundsChanged`
  after any in-place edit of a skinned or morphed part.
- A bound `SkinnedMesh` missing its `skinIndex` or `skinWeight` attribute
  has no finite bound (three skins it from generic attribute values), so it
  counts as in view wherever it is: its anchor never re-places while that
  part is counted. Give every skinned geometry both attributes, or hide or
  ignore such a part.
- The out-of-view dwell before acting (two consecutive "out" answers, a
  confirmation with `fresh: true`) is the caller's, not this module's.

## Examples

```ts
import {
  ANCHOR_VIEW_MARGIN_DEG,
  anchorBoundsNeedRefresh,
  createAnchorBoundsCache,
  createAnchorView,
  isAnchorInView,
  updateAnchorView,
} from 'gps-plus-slam-app-framework/ar/anchor-visibility';

const view = createAnchorView();
const cache = createAnchorBoundsCache();

renderer.setAnimationLoop((time) => {
  updateAnchorView(view, camera, renderer.xr);
  const inView = isAnchorInView(view, anchor, {
    marginDeg: ANCHOR_VIEW_MARGIN_DEG,
    cache,
    atLocal: targetMatrix,
    fresh: anchorBoundsNeedRefresh(cache, time),
    nowMs: time,
  });
  // ...
});
```

## Tests

- `anchor-visibility.test.ts`: one case per way a subtree can be drawn
  although a test of its root says otherwise (a tall child, a wide sprite, a
  non-default sprite center, a constant-size sprite, a sheared subtree, a
  scaled bone, a raised morph influence on a skinned and on a plain mesh,
  skin weights below one), the live hints, the margin, near and far, layers,
  the target pose, the sphere cap (merging the nearest pair, never a morphed
  part), the refresh, the merge root, the parent frame, the counters, input
  validation, each side of an off-axis projection widened by the margin, a
  cache reused for another anchor, a bone index outside the skeleton, sheared
  instances of an instanced and a batched mesh, the kept bind data (reused,
  then recomputed after an edit in place, an interleaved edit, a rebind and
  a swapped geometry whose attribute versions match, a geometry swapped in
  around the same attributes after an in-place morph edit, an interleaved
  attribute moved to another offset or item size of its buffer; kept per
  kind; a key of primitives only), a skinned mesh with no skeleton or zero
  weights, a bound skinned mesh missing a skin attribute (in view wherever
  it is, never merged), a view wider than the angle clamp,
  the anchor as its own merge root,
  and a premise test that drives a real `WebXRManager` frame loop.
- `anchor-visibility.property.test.ts`: never a false "out" against an
  exact oracle (every drawn triangle and sprite quad clipped against each exact
  view frustum), on a fresh traversal after live and structural changes and
  from the cache after live changes, over random subtrees (sheared groups,
  sprites, instanced meshes, morphed boxes, posed, scaled and morphed skinned
  meshes, merge roots, sheared instances) and random XR views at a margin of
  0, 5 or a random [0, 30) deg; a part just inside any side plane of any view
  at any margin; and parent-frame invariance. A
  non-vacuity floor checks that at least 10 % of the scenes draw something
  (measured 17-33 % over 24 seeds). Random views rarely graze a part's edge,
  so these properties are a safety net; the edge cases are pinned by the unit
  tests.
- `anchor-visibility.perf.test.ts`: operation counts (no traversal on a
  cached call, at most the cap per view for plain parts) and generous wall-clock ceilings for
  the cached test, a fresh traversal of 400 parts, and a 64-bone skinned part;
  400 parts at one and at four shared origins must cost under 4x the grid
  case timed in the same test (eager rescans measured 31x and 9x; the lazy
  rescan 1.0-1.5x, and 0.8-1.0x for 1 to 200 shared origins). Those two
  tests time 3 traversals per run, enough for an eager rescan to fail them
  (30x and 8.1x measured) while staying well inside the test timeout on CI.
  Measured on a desktop under about 75 % CPU load (best of 15): cached
  0.006-0.008 ms, fresh 400 parts in two views 4.1-4.4 ms, cached with a
  64-bone skinned part 0.013-0.016 ms. A phone is several times slower, so a
  fresh traversal of a large subtree belongs at the 1 s refresh, not per frame.
  Two CI runs measured the fresh traversal at 28.7 and 42.1 ms; its 150 ms
  ceiling sits about 3.6x above the slower one.
