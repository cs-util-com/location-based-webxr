# `deferred-anchors.ts`

## Purpose

Content under the AR world group (`arWorldGroup`) whose alignment correction
waits until none of it is in view. The group carries the alignment T
(odometry NUE to GPS-world NUE). A correction of T (a step of more than 1 m
at the camera, or the first change after a frame-epoch change) moves the
group onto T in the frame it arrives, so the world (map, globe, everything
under the scene root at its NUE pose) jumps at once; a smaller refinement
eases over about 0.3 s (lerp rate 8), see `ar-world-group-alignment.ts.md`.
A deferred anchor keeps its local matrix while it is in view, so
it stays put relative to the camera, and re-places itself to the latest
T^-1 once it is out of view. Raw tracking poses and the store are never
touched: the deferral is a scene-graph matter only.

## Public API

Deep import only: `gps-plus-slam-app-framework/ar/deferred-anchors`.

- `deferredAnchor(parent, key): DeferredAnchor` (the only runtime export
  besides the constants and the test hook)
  - `parent`: the AR world group. It must have an alignment binding
    (`enableArWorldGroupAlignment`), otherwise it throws an `Error` naming
    that call. `TypeError` for a non-`Object3D` parent or an empty key.
  - The parent's anchor set is created on first use and lives until the AR
    session ends (session disposer flush).
  - One key is one unit of content that moves together: all its roots
    share one local matrix and commit in the same pass.
- `DeferredAnchor`
  - `add(root, { onCommit? })`: `parent.add(root)`, sets
    `matrixAutoUpdate = false` and places the root at once (a new key at its
    NUE pose, a root added to an existing key at that key's matrix). A root
    is a pose-free wrapper: its own pose is replaced, poses go on its
    children. Throws for a root that already belongs to another key, a root that
    holds the parent, a root nested in (or holding) another anchor's root,
    and after the set was torn down.
  - `remove(root)`: detaches it and restores `matrixAutoUpdate`; the key is
    dropped with its last root. No-op after teardown.
  - `boundsChanged()`: call after a structural change of a root's subtree
    (parts added, removed, swapped); the next test rebuilds the bounds.
  - `onCommit(root)` runs after each placement (first, out of view, release,
    window entry, follow start) with the world matrices refreshed and before
    the frame renders; never for the per-frame follow steps. A throwing
    callback is logged and the others still run.
- Constants (`DEFERRED_ANCHOR_EPSILON_M`, `FRAME_JUMP_THRESHOLD_M`,
  `WINDOW_MIN_S` and `WINDOW_MAX_S` are exported, the rest module-local; the
  epsilon, the jump threshold and the window cap are swept in the tests):
  - `DEFERRED_ANCHOR_EPSILON_M = 0.02`: a key is pending when its content
    (the root-local box corners plus the origin) would move by more.
  - `FRAME_JUMP_THRESHOLD_M = 1`: a camera step between two frames, in the
    group's frame, that opens the frame-switch window.
  - `WINDOW_QUIET_S = 2`, `WINDOW_NOISE_FLOOR_M = 0.1`: the window closes
    after this long without a T step above the floor (at the content).
  - `WINDOW_SESSION_SHARE = 0.2`, `WINDOW_MIN_S = 10`, `WINDOW_MAX_S = 120`:
    the window's longest span after its last trigger,
    `clamp(0.2 * session seconds, 10, 120)`.
- `__runPassForTests(parent, cameraOrView, dt, elapsedS)`: test only. Runs
  the binding's lerp step and one pass; returns
  `{ sphereTests, traversals, windowOpen, followUpdates }`.

## Phases, in pass order

1. The previous frame's view is re-expressed by the parent's motion since
   then, so "in view last frame" means the same content rays after a T step.
2. Release (`requestAnchorRelease('code-lock')`, see `anchor-release.ts.md`):
   every pending key is placed at T^-1 at once (`release:code-lock`), the
   immature phase ends for the session and the window closes.
3. Window triggers: a frame-epoch change, or a camera step above the jump
   threshold (the raw camera in the group's frame, so a T step alone is no
   jump). The jump trigger never fires on the set's first pass (it needs a
   previous camera position). A release absorbs a trigger of its own pass.
   A trigger while open re-arms the cap; the quiet rule closes the window
   once `elapsed - last step >= 2 s`, a step being a T change above the noise
   floor at any key's content (box corners) or the origin.
4. Follow: while the window is open, or while the alignment is immature and
   no code has voted, every key's world pose is its NUE pose each frame
   (`window-entry` or `follow-start` when entering moves it by more than
   epsilon). After the phase ends a key keeps following until it is within
   epsilon of T^-1. A follow step is skipped while the parent's matrix is
   unchanged (`followUpdates` counts the steps that ran).
5. Deferred keys: each pending key is sorted into "cache invalid", "cached
   test says out", or "in, but the cache is stale"; one key is picked (out
   first, round robin), its bounds rebuilt if needed, and it commits
   `out-of-view` only when a fresh test agrees. A commit needs the content
   out of view at its current pose in this and the previous view, and at
   its new pose in this view (three tests). The picked key's fresh traversal
   also renews its corners (the box the epsilon and the window step are
   measured over), so a part mounted without `boundsChanged()` counts from
   that pass on.

## Invariants

- An in-view key changes its local matrix only to its NUE pose (follow,
  window entry) or, at a release, to T^-1, at most once per release.
- At most one key's subtree is traversed per pass (its view test and its
  corners), so k keys that all wait need k passes; the cached tests cost at
  most 3 tests per sphere (32 per root) per view slot.
- The lerper and the anchors read one T (`ar-parent-target.ts`); after
  convergence an anchor's world pose is its NUE pose.
- The set runs inside the binding's frame update, after the lerp step. When
  the binding is disposed first, the set falls back to its own frame update.
- Every commit logs `commit <kind>: <key>, waited <ms>, moved <m>`.

## Example

```ts
enableArWorldGroupAlignment({ store, arWorldGroup });
const root = new THREE.Group();
root.add(model); // the model's pose goes on the child
deferredAnchor(arWorldGroup, 'item-42').add(root, {
  onCommit: () => labels.refresh(),
});
```

## Tests

- `deferred-anchors.test.ts`: every rule above, the epsilon, window cap and
  jump threshold sweeps, the three view tests one by one, the previous view
  carried through a one-frame jump, the window rules (quiet at exactly 2 s,
  the noise floor between 0.08 and 0.12 m, the step at the content, the cap
  re-armed, a release absorbing its own trigger), corners in the root frame
  and renewed at a fresh traversal, follow in the parent frame, a correction
  frame (the group lands on T, a visible anchor holds), nesting, the
  binding-dispose fallback, the dev jump agreement and the per-pass budget
  (20 keys x 30 meshes, follow updates skipped while the parent is still).
- `deferred-anchors.property.test.ts`: random T, look, epoch, camera jump,
  release and maturity sequences; safety (an in-view change only at a
  release, or to the NUE pose while the oracle's own model says a follow is
  due or still running), liveness (k + 2 passes) and the NUE pose after
  convergence.
- `deferred-anchors.structure.test.ts`: no dispatch and no store slice
  imports in the anchor modules.
