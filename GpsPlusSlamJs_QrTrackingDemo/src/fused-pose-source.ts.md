# fused-pose-source.ts

## Purpose

The QR demo's fused QR pose (QR near-frontal pose plan 2026-09-23-2314,
M3b b5): one `createFusedQrPoseTracker` per decoded payload, fed by
`selectQrFusedEntries` (the `qrDetected` slice's current-epoch detections
as fused-window entries). The overlay takes the pose only once the window's
gate is open; until then the demo controller falls back to the raw frame
pose, as it did with today's stable pose.

## Public API

- `createFusedPoseSource(options?: QrFusedPoseOptions, hooks?): FusedPoseSource`
  - `resolve(state, text): Pose | null` - the fused pose when its status is
    `stable`, else null. Wired as the controller's `resolveStablePose`.
  - `last(text): QrFusedPose | null` - the last evaluation for `text` (status,
    method, fit, views), for a HUD or diagnostics; null if never read.
- `options` go to every tracker (window, gate, fallback thresholds; `solve`
  is injectable for tests).
- `hooks.onEvaluated(result, ms)` - called once per NEW evaluation (never
  for a cached re-read) with its cost on `hooks.now` (default
  `performance.now`): the demo's `?qrperf` `fused` stage (plan §30). The
  HUD's render evaluates first, so timing a later read would time a cache
  hit (b5 review #1).

## Invariants & assumptions

- One tracker per payload, kept for the page's life: two codes never share
  a window or a hysteresis state.
- Solves once per new detections array (the selector's and the tracker's
  caches), however often it is read - the HUD re-renders on every store
  change.
- After a frame change (`qrFrameChanged`, see `restart-tracking.ts`) the
  selector returns an empty array, so `resolve` gives null and the overlay
  falls back to the raw pose until the code is seen again.

## Examples

```ts
const fusedPose = createFusedPoseSource();
createQrDemoController({
  // ...
  resolveStablePose: (text) =>
    store ? fusedPose.resolve(store.getState(), text) : null,
});
```

## Tests

`fused-pose-source.test.ts`: nothing until the window is stable, then the
joint rotation; a restart forgets the old frame; codes stay apart; one solve
per new detection however often it is read.
