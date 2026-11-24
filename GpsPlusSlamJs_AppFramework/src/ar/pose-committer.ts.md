# pose-committer.ts

## Purpose

One committer per object: a claim that keeps two systems (a GPS anchor, a deferred anchor, the AR-space correction) from writing the same object's transform, which would apply their corrections on top of each other.

## Public API

- `PoseCommitter`: `'GPS anchor' | 'deferred anchor' | 'AR-space correction'`.
- `claimPose(object, committer, into = object.parent)`: throws when the object is already claimed (by anyone), holds a claimed object, or `into` or one of its ancestors is claimed; the message names the holder and says "nested" for the latter cases. A committer that re-parents the object as part of its claim (a deferred anchor) passes the new parent as `into`, so the chain the object is about to live in is checked, not the one it leaves.
- `releasePose(object, committer)`: releases only `committer`'s own claim; a no-op otherwise.
- `poseCommitterOf(object)`: the holder of `object` itself, or `null`.

## Invariants & assumptions

- A `WeakMap` keyed by the three.js object: a side table of imperative scene resources, not app state, so it lives outside the store; a dropped object frees its claim.
- **Checked at claim time only.** An app that later re-parents a claimed object into another claimed one is not seen here; each committer's own guards cover what they can (the deferred anchors' `excludeNested`).
- Claimed by `createGpsAnchor` (replacing its former module-local set; nested GPS anchors are refused through the same check), `DeferredAnchor.add` (released by `remove`, an excluded nested root and the set's dispose) and `ArSpaceCorrectionRegistry.track`.

## Tests

`pose-committer.test.ts`; the cross-committer cases in `ar-space-correction-registry.test.ts` and `ar-space-correction-committers.test.ts` (the real deferred-anchor and GPS-anchor APIs); `gps-anchor.test.ts` (nested anchors).
