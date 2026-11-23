# pose-committer.ts

## Purpose

One committer per object: a claim that keeps two systems (a GPS anchor, a deferred anchor, the AR-space correction) from writing the same object's transform, which would apply their corrections on top of each other.

## Public API

- `PoseCommitter`: `'GPS anchor' | 'deferred anchor' | 'AR-space correction'`.
- `claimPose(object, committer)`: throws when the object is already claimed (by anyone) or sits inside or holds a claimed object; the message names the holder and says "nested" for the second case.
- `releasePose(object, committer)`: releases only `committer`'s own claim; a no-op otherwise.
- `poseCommitterOf(object)`: the holder of `object` itself, or `null`.

## Invariants & assumptions

- A `WeakMap` keyed by the three.js object: a side table of imperative scene resources, not app state, so it lives outside the store; a dropped object frees its claim.
- **Checked at claim time only.** An app that later re-parents a claimed object into another claimed one is not seen here; each committer's own guards cover what they can (the deferred anchors' `excludeNested`).
- Claimed by `createGpsAnchor` (replacing its former module-local set; nested GPS anchors are refused through the same check), `DeferredAnchor.add` (released by `remove`, an excluded nested root and the set's dispose) and `ArSpaceCorrectionRegistry.track`.

## Tests

`pose-committer.test.ts`; the cross-committer cases in `ar-space-correction-registry.test.ts` (U7); `gps-anchor.test.ts` (nested anchors).
