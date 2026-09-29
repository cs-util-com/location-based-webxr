# tour-authoring-actions.ts

## Purpose

The `tourAuthoring/*` actions: what the creator setup dispatches so the
troubleshooting recording holds each placement, the code measurement and the
finish WITH the raw inputs they were computed from. Log-only - no reducer
reads them (the framework's `diagnostics/note` precedent). Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a.

## Public API

- `objectPlaced(payload)` - `tourAuthoring/objectPlaced`: `object` (the
  manifest record), `arVisitIndex` (AR sessions ended before this one),
  `atMs` (epoch), `reticleOdomNue` (a pin: the reticle in the world group's
  local frame, NUE odometry; null for a photo or without a group),
  `cameraOdomPose` (a photo: the frame's capture pose, raw WebXR odometry;
  null for a pin), `alignmentMatrix` (the store's, the solve's target),
  `arWorldGroupMatrix` (a pin: the group's rendered matrix, which lags the
  target while it lerps), `code` (the code last in view: text, fused status,
  fused pose or null), `codeSizeM` (the anchor code's printed size in metres
  the setup worked with, `ctx.activeSizeM` - known even with no code in
  view; a code's solved pose scales with it).
- `codeMeasured(payload)` - `tourAuthoring/codeMeasured`: `levelId`, `text`,
  `fusedOdomPose` (the stable fused pose minted from), `sizeM`,
  `alignmentMatrix`, `alignment` (the mint gate's info), `levelJson` (the level
  as written), `arVisitIndex`, `atMs`.
- `authoringFinished(payload)` - `tourAuthoring/finished`: `levelId`,
  `manifest` (what the rebuilt zip carries), `atMs`.
- Each creator carries `.type`, as RTK's do; the payload interfaces are
  module-private (knip), reachable as `Parameters<typeof objectPlaced>[0]`.

## Invariants & assumptions

- **No reducer, on purpose.** Dispatching one changes no state; the recording
  is the only place they exist. A reducer added later would make them
  ambiguous (the recording or the state?).
- **The prefix is derived, never typed twice.** The store persists
  `slicePrefixOf(objectPlaced.type)` (`tour-viewer-session.ts`); a rename here
  moves the persisted prefix with it.
- **JSON-safe payloads.** They are written to files as they are: tuples,
  plain records, numbers, strings, null. Poses and matrices are the library's
  tuples; the world group's matrix is `matrixWorld.toArray()`.
- **Dispatched at top level** (from the tap's handler, the mint's hash
  continuation, the finish's async body), never from inside another dispatch,
  so the persistence middleware's re-entrancy tripwire never fires and their
  recorded order follows what they depend on.
- **Not RTK's `createAction`** only because this package has no direct
  `@reduxjs/toolkit` dependency; adding one changes the lockfile, a root file
  that sends every commit gate to the full cascade.
- The `tourViewing/*` family of the plan is NOT here: it is born with the
  viewer recording (M1b), and a prefix may only be derived from an action that
  exists.

## Examples

```ts
arStore.dispatch(
  authoringFinished({ levelId, manifest: written, atMs: Date.now() }),
);
```

## Tests

- `creator-setup.test.ts` ("the troubleshooting recording's log of a
  placement"): a placed pin logs its reticle in odometry, the store's and the
  group's matrices, the code's printed size, and a JSON-safe payload; with
  the world group yawed 90 degrees the logged reticle is the group-local
  position (not the world one, nor the opposite rotation), and the logged
  matrix maps it back onto the reticle.
- `creator-finish.test.ts` ("the troubleshooting recording's log of the
  finish"): the finish logs the manifest the rebuilt zip carries.
- `authoring-recording.test.ts`: a finish dispatched on the page between two
  AR visits is in the recorded stream.
- `playwright-tests/ar-mode.spec.js` (the recording e2e): `codeMeasured`,
  `objectPlaced` and `finished` are in the saved zip, in order.
