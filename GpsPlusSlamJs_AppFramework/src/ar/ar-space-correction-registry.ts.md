# ar-space-correction-registry.ts

## Purpose

Bakes each relocalization jump into the local transform of the scene objects it tracks, once per jump, so their `position` and `quaternion` always hold their pose in the CURRENT raw frame (the frame of every new camera pose and hit test).

## Public API

- `createArSpaceCorrectionRegistry({ group })`: `group` is the node whose local space is O (`arWorldGroup`). `TypeError` for a non-`Object3D`.
- `registry.attach(store)`: follow a store (`getState`, `subscribe`). A previously attached store is detached first, and every entry restarts at the new store's epoch with no movement (its transform is already in the current frame). Returns a detach function; a stale detach (of a store already replaced) does nothing.
- `registry.track(object, { capturedAt?, epoch? })`: track `object` (a descendant of `group`) from its current local transform. Default epoch: the store's current epoch (a pose computed now). `capturedAt` (epoch-ms XR clock) for a pose computed from older data; `epoch` when known; not both. Jumps the object missed are applied at once. Tracking an object again restarts it from its current transform with the new options. Throws, before claiming anything: `TypeError` (not an `Object3D`, both options, NaN `capturedAt`), `RangeError` (not under `group`, an epoch that is not an integer in `0..n`, a parent chain whose `P` is not a similarity: a non-uniform scale, a shear, a zero or non-finite scale), `Error` (no store attached, or another committer owns the object or one of its ancestors or descendants).
- `registry.untrack(object)`: stop correcting; the transform keeps its current value; the claim is released.
- `TrackOptions`: the `{ capturedAt?, epoch? }` type, shared with the content watcher.
- The `arcorrected` event, `{ type: 'arcorrected', matrix }`, is declared on three's `Object3DEventMap` (module augmentation), so `object.addEventListener('arcorrected', e => e.matrix)` is typed.
- `registry.entryOf(object)`: `{ applied, correction, stampedAt, parentToGroup }` or `undefined`.
- `registry.dispose()`: untrack everything and detach.

## Invariants & assumptions

- **The bake:** per entry `applied` (observations whose jumps the transform already holds), `correction` (`Q`, the correction baked in since tracking, in O), `stampedAt` (the `capturedAt` hint or `null`) and `parentToGroup` (`P`, the product of the local matrices from `group` down to the parent, read at tracking time). On a new observation, an entry with `applied < n` gets `local := M * local` with `M = P^-1 * Delta(applied) * P`: `position := R_M * position + t_M`, `quaternion := q_M * quaternion`, and `matrix.premultiply(M)` for an object with `matrixAutoUpdate = false`. The scale is untouched (`M` is rigid while `P` is). Then `Q := Delta(applied) ∘ Q` and `applied := n`.
- **`arcorrected` once per bake:** after an object's transform is corrected it receives `{ type: 'arcorrected', matrix: M }` (column-major, frozen, and the same array for every object sharing `P` and `applied` in that sync). Listeners run inside the store notification, after the object and its entry are updated; a listener that throws is logged as an error and the other objects are still corrected (later listeners of that object miss that event). At tracking time the event is dispatched inside `track`, so a throwing listener reaches its caller. An object tracked at an older epoch receives it at tracking time too.
- **One `M` per parent and epoch:** each sync prepares `M` (and its decomposition) once per `P` array and `applied`, and `track` reuses a parent's `P` array while its elements are unchanged, so siblings share one preparation. At 1,000 direct children this is the difference between about 1 ms and about 15 ms per jump (`ar-content-watcher.perf.test.ts`).
- **Idempotent:** a notification that brings no new observations list changes nothing; a second sync applies nothing.
- **Equivalent to the from-scratch rule:** for an object not written after tracking, `local = P^-1 * Delta(e) * P * X_tracked`, however the jumps arrived.
- **App writes stay right:** after a jump the transform is in the current raw frame, so an absolute write from the current camera or a new hit test and a relative write (a bobbing coin) both need no call. The cost: an app keeping its own copy of a position (a physics body) must follow the change.
- **`P` is fixed at tracking time, and must be a similarity.** `P^-1 * D * P` is rigid only when `P` is a rotation, a uniform scale and a translation (checked as `P^T P = s^2 I` within a relative 1e-5, which passes float32 rotation chains and refuses any real shear or axis scale). An object whose parent chain changes must be tracked again. An explicitly tracked object the app removes or re-parents, or whose parent leaves the group, is untracked at the next jump with a warning, never moved (watched content is untracked at the removal itself, see `ar-content-watcher.ts`).
- **One failure stays one failure:** each object's bake runs in its own `try`; an exception is logged as an error and the other objects are still corrected.
- **One committer per object** (`pose-committer.ts`): a tracked object is claimed as `'AR-space correction'`; an object a GPS anchor or a deferred anchor owns, or one inside or holding such an object, cannot be tracked, and the reverse. The sanctioned combination for visitor content is "the pure helpers compute, the anchor commits": `shownLocalMatrix` and `arSpaceWorldPose` claim nothing.
- **Reads only the correction track,** never the GPS alignment, and never dispatches (structure test).
- **Scene resources, outside the store:** the entry map and the claims are imperative state about three.js objects; the correction itself is read from the store's selectors only. `matrixWorld` is refreshed by the next render (`matrixWorldNeedsUpdate` is set).
- **Far content** (more than about 8 m from the camera when placed) is out of scope by contract; nothing checks it at runtime.

## Examples

Apps normally use `enableArSpaceCorrection` (`ar-content-watcher.ts`), which tracks content as it is added. The registry directly:

```ts
const registry = createArSpaceCorrectionRegistry({ group: arWorldGroup });
const detach = registry.attach(store);
arWorldGroup.add(coin);
registry.track(coin); // placed from a hit test in this frame
registry.track(tile, { capturedAt: capture.capturedAt }); // from older data
// a relocalization arrives: coin.position now holds its corrected pose
```

## Tests

`ar-space-correction-registry.test.ts`: from-scratch equality (property, three.js as the oracle, over random chains of one to three parents with uniform scales and at least one manual matrix, random epochs, object scales and jumps; idempotence), an older epoch corrected at tracking with the `capturedAt` hint, the bake into position, quaternion and a manual matrix with the scale kept, a relative write after a jump, a store swap (no movement, next jump once, stale detach), untrack, one committer both ways with the sanctioned path, bad input, a non-similarity parent refused before claiming, one throwing object skipped and logged, an object that left its parent untracked. `ar-space-correction-committers.test.ts`: the rule through the real deferred-anchor and GPS-anchor APIs. `ar-space-correction.structure.test.ts`: import boundaries, including the whole relative-import closure.
