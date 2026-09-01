# wire-qr-recording.ts

## Purpose

Composes the live QR feature into a running AR session, gated by
`recordingOptions.qr.enabled`: the WS-2 **producer** (records RAW detections) and
the WS-5 **consumer** (debug axis+cube). `main.ts` calls it once in `handleEnterAR`
(after `arWorldGroup` exists) and disposes it on reset / re-entry.

## Public API

- `wireQrRecording(options) → dispose()`
  - `options.storeRef` — the active-store ref (producer + viz follow swaps).
  - `options.getArWorldGroup()` — parent for the debug objects.
  - `options.qr` — `{ enabled, intervalMs, captureSize }` (caller gates on `enabled`).
  - `options.setProducer(producer | null)` — receives the producer so the
    initAR `callbacks.cameraFrame.onFrame` (wired at Enter-AR) can forward frames to it.
  - returns a `dispose()` that stops capture, resets/clears the producer, detaches
    the debug subscriber + swap listener, and disposes the viz.

## Invariants & assumptions

- **Clock domain (load-bearing, open topic A):** the producer's `now` is
  `Date.now()` (EPOCH ms) — the SAME clock the recorded depth stream uses
  (`DepthSample.timestamp = performance.timeOrigin + frameTs`) — so the
  derive-on-read size as-of join (`depth.ts ≤ detection.ts`) pairs each detection
  with the right depth sample. Stamping `performance.now()` (relative) was the
  original "no debug cube" bug: it never satisfies the join.
- **Single cadence owner:** `startCameraFrameCapture({ intervalMs })` throttles;
  the producer runs `minIntervalMs: 0`.
- **rAF-coalesced viz updates (F3, perf-degradation fix):** per-store-action
  `debug.update()` calls are coalesced to at most one per animation frame (the
  store bursts depth + GPS + ~8 Hz QR); the initial wire + store swaps update
  synchronously for immediacy. The pending frame is cancelled on dispose.
- **Camera pose** comes from the current XR frame (`getCurrentArPose()`, Option A) —
  fresh every frame, not stale to the 1 Hz depth. **Projection** still comes from
  the latest depth sample (near-constant FOV; per-frame projection is open topic F).
  The observation's `imageWidth/Height` come from the detector-frame buffer.
- **Store-swap safe:** dispatches + reads go through `storeRef.get()`, and the
  debug subscriber re-attaches on every swap (Start Recording / replay).

## Tests

- `wire-qr-recording.test.ts` — producer clock is `performance.now()` not epoch;
  capture started with the configured cadence/size; producer handed to
  `setProducer`; camera pose/projection read from the latest depth sample;
  detections dispatch RAW into the current store; debug controller driven on change
  - re-attached across a swap; `dispose()` tears everything down. Framework
    producer/controller are mocked.

## Related

- [qr-debug-controller.ts.md](qr-debug-controller.ts.md), [qr-depth-resolver.ts.md](qr-depth-resolver.ts.md).
- `gps-plus-slam-app-framework/ar/qr/qr-detection-controller` — the thin producer.

## Two modes (added with M-E)

`options.qr` is `{ enabled, intervalMs, captureSize, useLevels }`, and
`useLevels` chooses which producer consumes the camera frames:

- **off (default)** — the thin `createQrDetectionController`: decode, validate
  the quad, dispatch a RAW observation. Nothing is fetched, and the session's
  recorded GPS is entirely real.
- **on** — `createQrTrackingController` instead: the same decode, plus a
  level lookup through `qr-level-source` and synthetic GPS votes into the
  store. **Only one producer runs.** Running both would decode every camera
  frame twice on the AR frame path, which is why the framework's detection
  event carries the raw corners and camera pose.

The raw record rides `onRawDetection` — the validated DECODE — not
`onDetection`, which fires on a locked, solved pose and therefore needs a
level and a size. A code whose level does not exist yet (every code on an
authoring walk, by definition) never locks, and gating the raw record on that
would mean the first recording of the loop recorded nothing at all.

## Other options this module takes

- `readAlignment` — the session's alignment as it stands NOW, read per
  detection and never recorded (see `qr-sighting-feeder.ts.md`).
- `setSightingFeeder` — hands the sighting fold out, for the zip contributor
  and the HUD.
- `onLevelState` — what a code's level lookup did, routed to the HUD so a
  code the session cannot use says so instead of being silent.

(The module header's note about the producer clock is the authority: it is
**epoch ms** via `Date.now()`, shared with the depth stream so the as-of size
join can pair them.)
