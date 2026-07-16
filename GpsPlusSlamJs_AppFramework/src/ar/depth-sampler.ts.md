# Depth Sampler

## Purpose

Samples sparse depth points from the WebXR depth sensing API at a configurable interval (~1 Hz default). Captures a grid of depth values with the camera pose for 3D reconstruction and validation.

## Public API

### Reconstruction cadence constants (2026-07-16)

- **`DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS = 500`** / **`DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE = 32`** — the recommended depth-sampling cadence for reconstruct-and-render apps (Recorder, PhysicsDemo), the depth-side counterpart of the `DEFAULT_OCCUPANCY_*` constants. Hoisted after field feedback that the demo, relying on the conservative library fallback (16×16 @ 1 Hz), reconstructed 8× slower than the recorder. Opt-in named constants — the fallback `DEFAULT_CONFIG` (16/1000) is deliberately unchanged so non-reconstruction consumers (MinimalExample/AnchorStarter) are not silently re-tuned.

### `DepthSampler` (class)

- **`constructor(callbacks: DepthSamplerCallbacks, config?: Partial<DepthSamplerConfig>)`** — creates a sampler with event callbacks and optional config overrides. The initial config is routed through the same validation as `updateConfig`, so invalid overrides (non-finite/non-positive `intervalMs`, fractional `gridSize`) are ignored at construction exactly as at runtime — the constructor cannot seat a value `updateConfig` would refuse.
- **`start(): void`** — begins sampling; resets counters and timers.
- **`stop(): void`** — stops sampling.
- **`isRunning(): boolean`** — returns whether sampling is active.
- **`getSampleCount(): number`** — number of samples captured since last `start()`.
- **`getConfig(): DepthSamplerConfig`** — returns a copy of the current config.
- **`updateConfig(config: Partial<DepthSamplerConfig>): void`** — applies partial overrides (the plumbing seam for the user's `depth.*` recording options, called by `startDepthCapture(config)`). Invalid values (non-finite, non-positive, fractional `gridSize`) are ignored defensively.
- **`onFrame(timestamp: number, acquireDepthInfo: () => DepthInfo | null): void`** — call once per XR frame with a LAZY provider (quality-review E-4, 2026-07-10: the caller used to acquire+wrap depth every frame while ~59/60 acquisitions were thrown away at the interval check; the provider is now invoked only when a sample is due). Throttles sampling to `intervalMs`. Unavailability detection is preserved: `lastSampleTime` only advances on emitted samples, so while depth is unavailable the sampler stays due and probes every frame.

### `wrapXRDepthInfo(raw, projectionMatrix)` (function)

Wraps a raw browser `XRDepthInformation` object into a `DepthInfo`: copies `width`/`height`, binds `getDepthInMeters` to the source object (browser implementations are this-sensitive), and defensively copies the capturing view's projection matrix (`XRView.projectionMatrix`) into a plain serializable 16-tuple. Invalid matrix input (missing, wrong length, non-finite entries) yields a `DepthInfo` without a matrix — never an error. It additionally preserves the **live-occluder metadata** when the source carries it: `data` (the raw `XRCPUDepthInformation` buffer) by **live reference** (NOT cloned — too large; valid only this frame), `rawValueToMeters` only when finite, and `normDepthBufferFromNormView.matrix` copied + validated exactly like `projectionMatrix`. The sparse sampler ignores all three; sources lacking them wrap exactly as before. Live-occluder Iter 1 ([2026-06-14-0009-webxr-depth-occlusion-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0009-webxr-depth-occlusion-plan.md) §2). Called by `webxr-session.ts` in the frame loop.

### Interfaces

- **`DepthSamplerConfig`** — `{ intervalMs, gridSize, unavailabilityThresholdMs, rgb }`; `rgb` (default **true**) gates the Iter-8 per-point color enrichment and accepts boolean overrides via `updateConfig`.
- **`DepthSamplerCallbacks`** — `{ onSampleCaptured, getCurrentPose, onDepthUnavailable?, acquireRgbLookup? }`; `acquireRgbLookup` lazily provides a camera-color lookup for the CURRENT frame — invoked at most once per **emitted** sample (never per frame/point; acquisition is a GPU-stall blit+readback) and only while `config.rgb` is true. Null/throwing acquisition degrades to color-less points (occupancy-grid port plan Iter 8).
- **`DepthInfo`** — subset of `XRDepthInformation`: `{ width, height, getDepthInMeters, projectionMatrix?, data?, rawValueToMeters?, normDepthBufferFromNormView? }`. The last three are occluder-only plumbing (the sampler reads only `getDepthInMeters`/`projectionMatrix`); `data` is a live per-frame reference, the other two are validated copies.

## Invariants & Assumptions

1. **Raw WebXR coordinate convention** — `cameraPos` in each `DepthSample` is the raw WebXR local-floor position (X=East, Y=Up, Z=South); `extractOdomPosition()` performs no conversion. Consumers (e.g. the occupancy grid) work directly in this frame; anything needing NUE must convert itself.
2. **Epoch-ms timestamps** — `timestamp` in `DepthSample` is `performance.timeOrigin + xrFrameTime`, matching all other persisted action timestamps (GPS events, images, reference points).
3. **Camera rotation is raw WebXR** — `cameraRot` quaternion `[x, y, z, w]` is taken directly from `ARPose.orientation` (no NUE conversion for rotations).
4. **Interval gating** — successive samples require at least `intervalMs` between them; intervening frames are skipped.
5. **Pose required** — if `getCurrentPose()` returns null the frame is silently skipped.
6. **Unavailability detection** — if no depth data arrives within `unavailabilityThresholdMs` of `start()`, `onDepthUnavailable` fires once.
7. **Intrinsics travel with the sample** — when the `DepthInfo` carries a `projectionMatrix`, it is copied into the emitted `DepthSample` (additive persisted-format field). Samples without it (old recordings) stay byte-identical to the previous format; consumers must skip unprojection for them.
8. **Per-point `rgb` is additive and absent when unavailable** (Iter 8) — when `config.rgb` is on and `acquireRgbLookup` yields a lookup, each point gains `rgb: [r, g, b]` (0–255); otherwise the field is ABSENT (not `undefined`) so persisted JSON stays identical to the pre-Iter-8 format. Every failure path (no callback, null acquisition, throw, per-point null) degrades to color-less points.

## Examples

```ts
const sampler = new DepthSampler({
  onSampleCaptured: (sample) => store.dispatch(recordDepthSample(sample)),
  getCurrentPose: () => xrSession.getCurrentPose(),
});
sampler.start();
// In XR frame loop:
sampler.onFrame(xrFrame.predictedDisplayTime, () =>
  getDepthInfoFromFrame(frame, pose)
);
```

## Tests

- `depth-sampler.test.ts` — covers:
  - Lifecycle (start/stop/isRunning)
  - Interval throttling
  - Grid sampling at various sizes (default 16×16)
  - Pose unavailability handling
  - Depth unavailability detection and callback
  - Raw-WebXR cameraPos convention
  - Epoch-ms timestamp conversion
  - projectionMatrix copy into samples + back-compat absence path
  - RGB enrichment (Iter 8): once-per-sample acquisition, `rgb: false` gating, back-compat absent field, null/throwing acquisition, per-point null fallback
  - `wrapXRDepthInfo` binding, tuple copy, and defensive matrix validation
