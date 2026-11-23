# ar-space-correction-registry.ts

## Purpose

Bakes each relocalization jump into the local transform of the scene objects it tracks, once per jump, so their `position` and `quaternion` always hold their pose in the CURRENT raw frame (the frame of every new camera pose and hit test).

## Public API

- `createArSpaceCorrectionRegistry({ group })`: `group` is the node whose local space is O (`arWorldGroup`). `TypeError` for a non-`Object3D`.
- `registry.attach(store)`: follow a store (`getState`, `subscribe`). A previously attached store is detached first, and every entry restarts at the new store's epoch with no movement (its transform is already in the current frame). Returns a detach function; a stale detach (of a store already replaced) does nothing.
- `registry.track(object, { capturedAt?, epoch? })`: track `object` (a descendant of `group`) from its current local transform. Default epoch: the store's current epoch (a pose computed now). `capturedAt` (epoch-ms XR clock) for a pose computed from older data; `epoch` when known; not both. Jumps the object missed are applied at once. Tracking a tracked object again (same parent) WITH a hint re-dates its placement: it holds the jumps `[start, applied)`, which is `Delta(applied)^-1 * Delta(start)` in O, and needs `[target, n)`, which is `Delta(target)`, so it receives `Delta(target) * Delta(start)^-1 * Delta(applied)` in O. A hint that arrives after a jump is still exact (no jump applied twice), also from a store listener that runs before the registry's own, while the newest jump is not applied yet (`applied < n`). This holds while the app has not rewritten the pose nor moved its container since the placement. Without a hint it restarts from its current transform, unmoved. To restart a placement the app rewrote since, track it without a hint first. Throws, before claiming anything: `TypeError` (not an `Object3D`, both options, NaN `capturedAt`), `RangeError` (not under `group`, an epoch that is not an integer in `0..n`, a parent chain whose `P` is not a similarity: a non-uniform scale, a shear, a zero or non-finite scale), `Error` (no store attached, or another committer owns the object or one of its ancestors or descendants).
- `registry.untrack(object)`: stop correcting; the transform keeps its current value; the claim is released.
- `TrackOptions`: the `{ capturedAt?, epoch? }` type, shared with the content watcher.
- The `arcorrected` event, `{ type: 'arcorrected', matrix }`, is declared on three's `Object3DEventMap` (module augmentation), so `object.addEventListener('arcorrected', e => e.matrix)` is typed.
- `registry.isAttached()`: whether a store is attached.
- `registry.entryOf(object)`: `{ applied, correction, stampedAt, start }` or `undefined`.
- `registry.dispose()`: untrack everything and detach.

## Invariants & assumptions

- **The bake:** per entry `applied` (observations whose jumps the transform already holds), `correction` (`Q`, the correction baked in since tracking, in O), `stampedAt` (the `capturedAt` hint or `null`), `start` (the epoch the placement belongs to) and the parent at tracking time. `P`, the product of the local matrices from `group` down to the parent, is read fresh in every sync, on its first use in that sync, once per parent object. On a new observation, an entry with `applied < n` gets `local := M * local` with `M = P^-1 * Delta(applied) * P`: `position := R_M * position + t_M`, `quaternion := q_M * quaternion`, and `matrix.premultiply(M)` for an object with `matrixAutoUpdate = false`. The scale is untouched (`M` is rigid while `P` is). Then `Q := Delta(applied) ∘ Q` and `applied := n`.
- **`arcorrected` once per bake:** after an object's transform is corrected it receives `{ type: 'arcorrected', matrix: M }` (column-major, frozen, and the same array for every object with the same parent object and `applied` in that sync). Listeners run inside the store notification, after the object and its entry are updated; a listener that throws is logged as an error and the other objects are still corrected (later listeners of that object miss that event). At tracking time the event is dispatched inside `track`, so a throwing listener reaches its caller. An object tracked at an older epoch receives it at tracking time too.
- **One `M` per parent and epoch:** each sync reads `P` and prepares `M` (and its decomposition) once per parent object and `applied`, so siblings share one preparation and one frozen `matrix`. At 1,000 direct children this is the difference between about 1 ms and about 15 ms per jump (`ar-content-watcher.perf.test.ts`).
- **Listeners during a sync:** the sync walks a snapshot of the entries and skips one that an `arcorrected` listener of an earlier object untracked, removed or re-tracked, so it is neither moved nor warned about. The one-shot `removed` listener untracks only its own placement: a removed listener that ran first and put the object back made a new placement, which stays tracked.
- **A sync never throws:** it runs inside a store subscriber, so a fault would come out of the app's dispatch (a GPS fix, a recorded frame); it is logged as an `ArSpaceCorrection` error instead.
- **Idempotent:** a notification that brings no new observations list changes nothing; a second sync applies nothing.
- **Equivalent to the from-scratch rule:** for an object not written after tracking and whose container did not move, `local = P^-1 * Delta(e) * P * X_tracked`, however the jumps arrived.
- **App writes stay right:** after a jump the transform is in the current raw frame, so an absolute write from the current camera or a new hit test and a relative write (a bobbing coin) both need no call. The cost: an app keeping its own copy of a position (a physics body) must follow the change.
- **`P` is read at each jump, and must be a similarity.** A container the app moved or turned between jumps is read where it is, so its items land on their physical spot (`D * K * L` in O for a container at `K`). `P^-1 * D * P` is rigid only when `P` is a rotation, a uniform scale and a translation (checked as `P^T P = s^2 I` within a relative 1e-5, which passes float32 rotation chains and refuses any real shear or axis scale): refused with a `RangeError` at tracking, and logged and skipped per object at a jump. A tracked object that is removed or re-parented is untracked at once (a one-shot `removed` listener, removed again by `untrack`), so a cache that evicts with `remove()` leaves nothing behind; one whose parent leaves the group is untracked at the next jump with a warning, never moved.
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

`ar-space-correction-registry.test.ts`: from-scratch equality (property, three.js as the oracle, over random chains of one to three parents with uniform scales and at least one manual matrix, random epochs, object scales and jumps; idempotence), an older epoch corrected at tracking with the `capturedAt` hint, the bake into position, quaternion and a manual matrix with the scale kept, a relative write after a jump, a store swap (no movement, next jump once, stale detach), untrack, one committer both ways with the sanctioned path, bad input, a non-similarity parent refused before claiming, one throwing object skipped and logged, an object that left its parent untracked, removed and re-parented objects untracked at once, a cache evicting with `remove()` leaving no entry, claim or listener, a hint after tracking re-dating exactly after a jump (and back again; the same hint twice is a no-op), an object untracked or despawned by a sibling's `arcorrected` listener (not moved, no event, no warning), a placement made by a `removed` listener kept, a sync fault logged and never thrown, and a hint from a store listener that runs before the registry, while a jump is pending, re-dating exactly with non-commuting jumps (and the unchanged hint then only delivering that jump). `ar-space-correction-committers.test.ts`: the rule through the real deferred-anchor and GPS-anchor APIs. `ar-space-correction.structure.test.ts`: import boundaries, including the whole relative-import closure.
