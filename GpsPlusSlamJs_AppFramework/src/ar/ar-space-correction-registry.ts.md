# ar-space-correction-registry.ts

## Purpose

Bakes each relocalization jump into the local transform of the scene objects it tracks, once per jump, so their `position` and `quaternion` always hold their pose in the CURRENT raw frame (the frame of every new camera pose and hit test).

## Public API

- `createArSpaceCorrectionRegistry({ group })`: `group` is the node whose local space is O (`arWorldGroup`). `TypeError` for a non-`Object3D`.
- `registry.attach(store)`: follow a store (`getState`, `subscribe`). A previously attached store is detached first, and every entry restarts at the new store's epoch with no movement (its transform is already in the current frame). Returns a detach function; a stale detach (of a store already replaced) does nothing.
- `registry.track(object, { capturedAt?, epoch? })`: track `object` (a descendant of `group`) from its current local transform. Default epoch: the store's current epoch (a pose computed now). `capturedAt` (epoch-ms XR clock) for a pose computed from older data; `epoch` when known; not both. Jumps the object missed are applied at once. Tracking an object again restarts it from its current transform with the new options. Throws: `TypeError` (not an `Object3D`, both options, NaN `capturedAt`), `RangeError` (not under `group`, an epoch that is not an integer in `0..n`), `Error` (no store attached, or another committer owns the object or one of its ancestors or descendants).
- `registry.untrack(object)`: stop correcting; the transform keeps its current value; the claim is released.
- `registry.entryOf(object)`: `{ applied, correction, stampedAt, parentToGroup }` or `undefined`.
- `registry.dispose()`: untrack everything and detach.

## Invariants & assumptions

- **The bake:** per entry `applied` (observations whose jumps the transform already holds), `correction` (`Q`, the correction baked in since tracking, in O), `stampedAt` (the `capturedAt` hint or `null`) and `parentToGroup` (`P`, the product of the local matrices from `group` down to the parent, read at tracking time). On a new observation, an entry with `applied < n` gets `local := M * local` with `M = P^-1 * Delta(applied) * P`: `position := R_M * position + t_M`, `quaternion := q_M * quaternion`, and `matrix.premultiply(M)` for an object with `matrixAutoUpdate = false`. The scale is untouched (`M` is rigid while `P` is). Then `Q := Delta(applied) ∘ Q` and `applied := n`.
- **Idempotent:** a notification that brings no new observations list changes nothing; a second sync applies nothing.
- **Equivalent to the from-scratch rule:** for an object not written after tracking, `local = P^-1 * Delta(e) * P * X_tracked` (U2), however the jumps arrived.
- **App writes stay right:** after a jump the transform is in the current raw frame, so an absolute write from the current camera or a new hit test and a relative write (a bobbing coin) both need no call. The cost: an app keeping its own copy of a position (a physics body) must follow the change.
- **`P` is fixed at tracking time.** An object whose parent chain changes must be tracked again.
- **One committer per object** (`pose-committer.ts`): a tracked object is claimed as `'AR-space correction'`; an object a GPS anchor or a deferred anchor owns, or one inside or holding such an object, cannot be tracked, and the reverse. The sanctioned combination for visitor content is "the pure helpers compute, the anchor commits": `shownLocalMatrix` and `arSpaceWorldPose` claim nothing.
- **Reads only the correction track,** never the GPS alignment, and never dispatches (structure test).
- **Scene resources, outside the store:** the entry map and the claims are imperative state about three.js objects; the correction itself is read from the store's selectors only. `matrixWorld` is refreshed by the next render (`matrixWorldNeedsUpdate` is set).
- **Far content** (more than about 8 m from the camera when placed) is out of scope by contract; nothing checks it at runtime.

## Examples

```ts
const registry = createArSpaceCorrectionRegistry({ group: arWorldGroup });
const detach = registry.attach(store);
arWorldGroup.add(coin);
registry.track(coin); // placed from a hit test in this frame
registry.track(tile, { capturedAt: capture.capturedAt }); // from older data
// a relocalization arrives: coin.position now holds its corrected pose
```

## Tests

`ar-space-correction-registry.test.ts`: U2 (property: from-scratch equality over random parent chains, epochs, scales and jumps; idempotence), U5 (older epoch corrected at tracking, `capturedAt` hint), the bake into position, quaternion and a manual matrix with the scale kept, a relative write after a jump, a store swap (no movement, next jump once, stale detach), untrack, U7 (one committer both ways, the sanctioned path), bad input. `ar-space-correction.structure.test.ts`: import boundaries.
