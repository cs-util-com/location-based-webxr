# ar-content-watcher.ts

## Purpose

Automatic AR-space correction of app content. `enableArSpaceCorrection` creates a framework-owned group, `arContent`, under `arWorldGroup`; every object added to it is tracked by the correction registry (`ar-space-correction-registry.ts`) the moment it is added, so after an ARCore relocalization each object is moved back onto its physical place with no call from the app.

## Public API

- `enableArSpaceCorrection({ store, arWorldGroup })` returns `{ arContent, arCorrection }`. `TypeError` when `arWorldGroup` is not an `Object3D` or `store` lacks `getState` / `subscribe`. `arContent` is a `THREE.Group` named `'arContent'` with the identity transform, added to `arWorldGroup`. Logs one info line naming the rule: content goes into `arContent`.
- `arCorrection.track(object, { capturedAt?, epoch? })`: say which epoch the object's current pose belongs to. Under `arWorldGroup` (watched or not, for example a tile under a framework node) it is tracked now; anywhere else the hint is kept (a `WeakMap`) and applied when the object is added to a watched group. Throws `TypeError` for an excluded object, a container, both options or a NaN `capturedAt`.
- `arCorrection.untrack(object)`: stop correcting it and drop a pending hint; content added while no store is attached is then not tracked at the next attach either.
- `arCorrection.container(group)`: mark a group that collects items over time. It is never corrected itself; its direct children are tracked one by one. Returns `group`. Marking a group already under a watched node starts watching it at once.
- `arCorrection.exclude(object)`: never track it (a helper, a cursor, a camera-relative HUD), now or after any later add.
- `arCorrection.attach(store)`: follow a new store (a new recording in the same AR session). Nothing moves; the next jump of the new store is applied once. Content added to a watched group after the returned detach function ran (no store attached) is not tracked then: a warning is logged, its hint is kept, and it is tracked at the next attach. A failure then (another committer claimed it meanwhile) is logged, not thrown: the add that placed it returned long ago, and `attach` still returns its detach function.
- `arCorrection.dispose()`: remove every listener, untrack everything, detach. `arContent` stays in the scene.
- Every corrected object receives `{ type: 'arcorrected', matrix }` once per jump (see the registry sidecar).

## Invariants & assumptions

- **What is tracked:** each direct child of `arContent` or of a watched container is one rigid item, tracked from its local transform at the add, with the store's current epoch unless a hint says otherwise. A removed child is untracked and its pending hint dropped; a re-added child is a new placement. A child that one of its own `removed` listeners already put back into a watched group is left tracked (three.js fires `childremoved` after those listeners). `arContent` is itself the root container: `track(arContent)` and `exclude(arContent)` throw a `TypeError`, `container(arContent)` returns it. `childadded` and `childremoved` fire for `add`, `attach` and re-parenting, so `container.attach(item)` keeps the item's world pose and starts a new placement.
- **What is not:** content added to `arWorldGroup` directly (framework anchors, tiles, occupancy nodes) stays out by placement; grandchildren of an item move with the item; containers and excluded objects are never claimed.
- **Containers may move:** a chest carried to a new place (and turned) carries its items, and every jump reads the container where it is then, so its items land on their physical spot.
- **The transform IS the corrected pose:** after a jump, `position` and `quaternion` hold the pose in the current raw frame. An app that records positions and reads them back later (a physics body, a saved layout) holds values from before the jump; it can listen to `arcorrected` and apply `matrix`.
- **`InstancedMesh`:** one tracked item. Its instance matrices are in its own local space, so they move with it; per-instance placement times are not supported (use one mesh per epoch, or a container).
- **One committer per object:** an object a GPS anchor or a deferred anchor owns cannot be added to `arContent` (the claim throws inside `add`); use the anchor APIs for such content.
- **Failures throw out of `add`:** a claim conflict, a parent chain that is not a similarity (a container with a non-uniform scale) or an `arcorrected` listener that throws while an object is tracked throws out of the `add` that placed it. When a container is added with children, every child is placed first and the first failure is rethrown (the others are logged). three.js's multi-argument `add(a, b, c)` adds one argument at a time, so after a throwing argument the later ones are not added at all; the earlier ones are tracked.
- **Late hints:** `track(object, { capturedAt })` after the add re-dates the placement exactly, even with jumps in between, as long as the app has not rewritten the pose nor moved its container since the add. It may also be given from a store listener that runs before the correction's own.
- **Scene state outside the store:** the listeners, containers, exclusions and hints are imperative state about three.js objects (`WeakSet` and `WeakMap`, so a dropped object is collected); the correction is read from the store's selectors only, and the watcher never dispatches (structure test).

## Examples

A coin game: coins placed from hit tests, one bobbing, one carried into a chest that collects coins over time.

```ts
const { arContent, arCorrection } = enableArSpaceCorrection({
  store,
  arWorldGroup: scene.arWorldGroup,
});

// A coin placed from this frame's hit test: no further call.
const coin = makeCoin();
coin.position.copy(hit.position);
arContent.add(coin);

// A coin placed from a pose captured earlier (a QR scan from 300 ms ago).
const late = makeCoin();
arCorrection.track(late, { capturedAt: scan.capturedAt });
late.position.copy(scan.position);
arContent.add(late);

// Relative writes stay right after a jump.
renderer.setAnimationLoop((t) => {
  coin.position.y = baseY + 0.05 * Math.sin(t / 300);
});

// A chest that collects coins; the chest itself is never corrected.
const chest = arCorrection.container(new THREE.Group());
chest.position.copy(chestHit.position);
arContent.add(chest);
chest.attach(coin); // keeps its world pose, tracked as a new placement

// A cursor that follows the reticle every frame stays out.
arCorrection.exclude(cursor);
arContent.add(cursor);

// A sound or particle effect at the moment of a correction.
coin.addEventListener('arcorrected', (e) => playShimmer(e.matrix));
```

## Tests

- `ar-content-watcher.test.ts`: the coin game frame by frame through two jumps (placed, moved, bobbing, glued to the camera, excluded, inside a container), hints before and after the add and inside a container, `arcorrected` counts, `M`, the pose already baked inside the listener, and one `M` shared by siblings under `arContent` and inside one container, a container moved and turned before a jump, content added while detached, one failing child among its siblings, a failure at attach logged with the detach function kept, untrack of waiting content, store swap, `arContent` as the root container, a child put back by its own `removed` listener staying tracked, a stale hint dropped when a child leaves while detached, and contract pins (`InstancedMesh`, anchor claims, direct `arWorldGroup` content, re-parenting, container removal, dispose, bad calls).
- `ar-content-watcher.property.test.ts`: random sequences of adds, attaches, removals, absolute and relative writes, hints (also from a store listener while a jump is pending), exclusions, container moves and jumps against an independent model; untracked and excluded objects never move; a second sync changes nothing.
- `ar-content-watcher.perf.test.ts`: one bake at 100, 1,000 and 10,000 objects, direct and in 10 containers, with the measured table in its header.
- `ar-space-correction.structure.test.ts`: the watcher's import closure reaches neither the GPS alignment nor the composed selectors.
