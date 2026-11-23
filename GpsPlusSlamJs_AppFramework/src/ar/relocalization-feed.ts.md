# relocalization-feed.ts

## Purpose

Watches the raw viewer pose of every XR frame and turns a platform frame switch (an ARCore relocalization) into one raw `arSpaceCorrection/relocalizationObserved` observation in the current store. It is the producer of the AR-space correction (`ar-space-correction.ts`, `state/ar-space-correction-slice.ts`); the registry and `arContent` (`ar-space-correction-registry.ts`, `ar-content-watcher.ts`) consume what it records.

## Public API

- `RELOCALIZATION_JUMP_M = 1`, `RELOCALIZATION_MAX_GAP_MS = 500`.
- `relocalizationJumpVerdict(prev, next, dtMs, maxStepM?)`: `'jump'` on a 3D step strictly over `maxStepM`, `'cannot-judge'` past `RELOCALIZATION_MAX_GAP_MS`, else `'no-jump'`; `prev` null is `'no-jump'`. `RangeError` on a position that is not three finite numbers, a bad bound, or (with `prev`) a negative or non-finite interval. A local copy of the library's `rawPoseJumpVerdict`, to be replaced by it once the library exports it.
- `createRelocalizationFeed({ getStore, beforeDispatch?, onObserved? })`: a feed the caller drives.
  - `frame(t, pose | null)`: one render frame, `t` in the epoch-ms XR clock. Never throws.
  - `forget()`: drop the earlier poses (the host's tracking loss, recovery and origin-reset hooks).
  - `isStopped()`, `dispose()`.
- `startRelocalizationFeed(options & { timeOriginMs? })`: the same feed driven by `registerXrFrameUpdate`; each frame reads `frame.getViewerPose(referenceSpace)` and stamps `timeOriginMs + elapsed * 1000` (default `performance.timeOrigin`). `dispose` also unregisters the callback.
- `rawCameraPose(viewerPose | null)`: `views[0]`'s transform as a `Pose`; `null` for no pose, an emulated pose or no view.
- `describeObservation(observation)`: the readout line (`|D|` m and degrees, the compensation verdict with the camera's measured step and turn, the frame gap).

## Invariants and defensive measures

- **Raw only:** the observation is `{ t, tLast, lastPose, tPrev, prevPose, newPose }` as the frames gave them (copied, so reused caller arrays change nothing). `t` is the jump frame's own time, `newPose` its own pose.
- **Forgetting:** a `null` or emulated pose, a non-finite pose or time, a clock that did not advance, a gap over 500 ms and `forget()` all drop the earlier poses, so nothing is observed across a tracking loss, a recovery, an origin reset or a stall. After a jump the frame before it is dropped as `prevPose`: it is in the old frame.
- **Order:** `beforeDispatch` (the QR sighting fold closes its burst) runs before the dispatch, then the readout line is logged (`ArSpaceCorrection`, info), then `onObserved`.
- **The current store:** `getStore` is read at each jump, so a per-recording store swap needs no call. `null` drops the observation with a warning.
- **Never in the way:** a fault inside a frame (a throwing store, a throwing hook) is logged once as an error and switches the feed off for the session; the frame loop never sees a throw. A viewer pose that throws is a skipped frame.
- **The frame order:** the XR callbacks run before the frame's image capture and depth sampler in `webxr-session.ts`, so the observation is in the store before any capture of the jump frame is stamped.
- No three.js and no scene access; the feed only dispatches.

## Parameters

- `RELOCALIZATION_JUMP_M = 1` and `RELOCALIZATION_MAX_GAP_MS = 500`: the library rule's values. At 1.5 m/s walking a 500 ms gap is 0.75 m, below the bound; a 700 ms gap would let a stall read as a 1.05 m jump. A 300 ms gap rule would miss jumps across short stalls. Lowering the bound below about 0.3 m would approach a fast walker's per-frame step at low frame rates.

## Example

```ts
const feed = startRelocalizationFeed({
  getStore: () => store,
  beforeDispatch: () => qrFeeder?.noteFrameChange(),
});
// tracking hooks: onLost / onRecovered / onRestarted -> feed.forget()
// session end: feed.dispose()
```

## Tests

- `relocalization-feed.test.ts`: the jump rule's cells and errors; one 3 m switch giving the exact raw observation and the hook order; walking never dispatching; nothing across a lost pose, a forget or a long gap, and the rule working after each; no `prevPose` from before a jump; copied poses; bad times and poses without a throw; the store current at the jump and a missing store; a fault switching the feed off once; the readout line; the XR wrapper's clock, emulated poses, dispose and a throwing viewer pose.
- `relocalization-feed.property.test.ts`: random walks with jumps, stalls and lost poses against an independent model: observations exactly at the model's jumps, all accepted by the reducer.
