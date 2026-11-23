# `deferred-anchors.ts`

## Purpose

Content under the AR world group (`arWorldGroup`) whose alignment correction
waits until none of it is in view. The group carries the alignment T
(odometry NUE to GPS-world NUE). Every change of T moves the group onto T
in the frame it arrives, so the world (map, globe, everything under the
scene root at its NUE pose) jumps at once, see
`ar-world-group-alignment.ts.md`.
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
    and after the set was torn down. The root is claimed as `'deferred anchor'`
    through `pose-committer.ts`, so a GPS anchor or the AR-space correction
    cannot also write it, or an object inside or holding it.
  - `remove(root)`: detaches it, restores `matrixAutoUpdate` and releases the
    claim; the key is dropped with its last root. No-op after teardown. The
    set's dispose releases every root it still holds.
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
- `joinAnchorSet(parent, member): AnchorSetMembership` (`@internal`, for
  `createGpsAnchor`): joins a position member to the parent's set. With a
  binding it is the same set the deferred keys use; without one the parent
  gets a set of its own with no window (T is a fixed identity), which runs on
  its own frame-loop registration and ends with its last member, or hands
  its members to the bound set once the parent gains a binding. Throws for
  a member object inside, or holding, a deferred root.
  - `AnchorSetMember`: `object` (the set writes its `position`), `camera`
    (the view when the session has no camera), `step(dt, elapsedS, target,
into)` (writes the target local position, returns the threshold below
    which a difference is not worth a commit, or null for no target this
    frame; `target` is the binding's target while bound, else null),
    `ungated()` (`'every-tick'`, `'first'` or null) and `placed()` (after each
    commit).
  - `AnchorSetMembership`: `leave()` and the test seam
    `runPassForTests(view, dt, elapsedS)`.
- `observeDeferredAnchorPasses(observer): () => void`: a diagnostic
  observer (one at a time; a newer one replaces) that sees every production
  pass of every set as `DeferredAnchorPassSample { passMs, dt, counts,
deferring }`. `passMs` is the pass's `performance.now()` span, measured
  only while an observer is set, so a page without one pays nothing. A
  throwing observer is logged and the frame goes on. The returned stop
  clears it only while it is still the current one. `TypeError` for a
  non-function. The Tour Viewer's `?debug=1` anchor log uses it.
- `__runPassForTests(parent, cameraOrView, dt, elapsedS)`: test only. Runs
  the binding's alignment step and one pass; returns
  `{ sphereTests, traversals, windowOpen, followUpdates }`.

## Phases, in pass order

With the deferral off (`target.defersAnchors` false, `?anchors=0` in
development builds) every key follows each frame as in phase 4, and every
pending member commits at once (`deferral-off`), so every correction lands
at once. That includes the position members: a GPS anchor in
`snap-when-offscreen` mode loses its own view gate as well and lands in
view (`gps-anchor.anchor-set.test.ts`, "the deferral switch"). The set
logs `deferral off` once when it is created.

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
5. Position members: each member's `step` runs (a throw is logged and costs
   that member its frame). A difference below its threshold, or within
   `DEFERRED_ANCHOR_EPSILON_M` (2 cm) whatever the threshold, is not
   pending: a member with threshold 0 (`snap-every-tick`) lands within
   2 cm of its target, not exactly.
   Otherwise it commits now at a release (`release:code-lock`, even below the
   threshold), when ungated (`every-tick`, `first`) or while the window is
   open (`window`); else it is pending. Members take no follow phase:
   inside the window every pass whose difference passes the threshold
   commits, so a member follows T in steps of its own threshold, the same
   hysteresis it keeps out of view, where a key follows T exactly. Taking
   only the window's first commit would hold the member at a stale place for
   the rest of the window; following below its threshold would break the
   member's own rule that it never moves for less.
6. Deferred keys and pending members: each pending key is sorted into "cache invalid", "cached
   test says out", or "in, but the cache is stale"; one key is picked (out
   first, round robin), its bounds rebuilt if needed, and it commits
   `out-of-view` only when a fresh test agrees. A commit needs the content
   out of view at its current pose in this and the previous view, and at
   its new pose in this view (three tests). A member is tested at its target
   position with its own rotation and scale. The picked key's fresh traversal
   also renews its corners (the box the epsilon and the window step are
   measured over), so a part mounted without `boundsChanged()` counts from
   that pass on.

## Invariants

- An in-view key changes its local matrix only to its NUE pose (follow,
  window entry) or, at a release, to T^-1, at most once per release.
- At most one key's subtree is traversed per pass (its view test and its
  corners), so k keys that all wait need k passes; the cached tests cost at
  most 3 tests per sphere (32 per root) per view slot.
- The binding and the anchors read one T (`ar-parent-target.ts`); once a
  key is at T^-1 its world pose is its NUE pose.
- The set runs inside the binding's frame update, after the alignment step. When
  the binding is disposed first, the set falls back to its own frame update.
- A position member moves only to its target: out of view (the three
  tests), at a release, in the window, or ungated. `'every-tick'` is the
  member's own choice to skip the view gate (`snap-every-tick`), not a
  bypass of the set.
- Nesting is refused between keys, between a key and a member, in both
  directions. One parent runs one set: a member that joined before the
  parent had a binding is handed to the bound set by its unbound set's
  next pass once the binding exists (that set then ends). A member the
  bound set refuses there (it nests with a key added meanwhile) is logged
  once and stays in the unbound set, which keeps running it.
- Known limit: a member's target is a position in the parent's frame, and
  the set writes it as the object's local position and tests the view at it
  the same way. That is exact for a direct child of the parent (every
  current caller); for a deeper descendant, which `createGpsAnchor`
  accepts, both the commit and the target-pose view test would be off by
  the intermediate nodes' transform. A fix belongs in the member and the set
  together (the member's own threshold check compares in that frame too).
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
  (20 keys x 30 meshes, follow updates skipped while the parent is still),
  the deferral switch (an in-view key lands on every correction) and the
  pass observer (production passes, stop, a throwing observer).
- `deferred-anchors.property.test.ts`: random T, look, epoch, camera jump,
  release and maturity sequences; safety (an in-view change only at a
  release, or to the NUE pose while the oracle's own model says a follow is
  due or still running), liveness (k + 2 passes) and the NUE pose after
  convergence.
- `../visualization/gps-anchor.anchor-set.test.ts`: the position-member
  rules through `createGpsAnchor` (child and target pose in view, the
  previous view, threshold, ungated modes, immature, release, window, the
  binding's T against the caller's alignment, nesting, a second
  above-threshold correction inside one window, a member that joined before
  the binding moved to the bound set and leaving it on dispose, a refused
  one kept running, a member in view landing at once with the deferral off).
- `deferred-anchors.structure.test.ts`: no dispatch and no store slice
  imports in the anchor modules.
