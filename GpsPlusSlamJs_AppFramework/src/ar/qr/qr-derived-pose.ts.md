# qr-derived-pose.ts

## Purpose

Derive-on-read layer for QR detections (decision **D-A** of the recorder live-QR plan).
Given the **raw** detector output per observation, recompute the metric **size** and the
solved **world pose** on read — so swapping the size/PnP algorithm and re-running a
recording yields a new result ("record raw, re-test"). Live and replay run the _same_
functions, differing only in the injected `resolveDepthAt`.

## Public API

- `interface RawQrObservation` — `{ text, corners (pixels, TL,TR,BR,BL), cameraPose (raw
WebXR), projectionMatrix (col-major GL), imageWidth, imageHeight, timestamp, orderSource? }`. The
  authoritative recorded shape; carries **no depth**. `orderSource` (where the
  corner order came from, QR near-frontal pose plan §60) lets a replay ignore
  native-order frames of an ordered code; absent in recordings made before it.
- `interface DeriveQrPoseDeps` — `{ resolveDepthAt(timestamp) → QrSizeDepthContext | null,
solver: SolvePnpSquare, sizeOptions?, maxReprojectionErrorPx? }`.
- `deriveQrSizeM(text, observations, resolveDepthAt, sizeOptions?) → number | null` —
  replays the history through a fresh `createQrSizeMeasurer`, each observation sized
  against its own as-of depth; returns the running-median size or `null`.
- `solveQrPoseFromObservation(observation, sizeM, solver, maxReprojectionErrorPx?) → Pose |
null` — pure PnP solve of one observation (intrinsics from its projection + frame size).
- `interface DerivedQrPlacement` — `{ pose: Pose, sizeM: number }`: a best-effort placement
  carrying both the solved pose AND the metric size that solved it (the debug cube needs the
  size).
- `deriveQrPlacement(text, observations, deps) → DerivedQrPlacement | null` — accumulate size
  over the history, solve the **latest** observation, return BOTH pose and size in one history
  pass; `null` on empty history / unsizeable / PnP-rejected.
- `deriveSolvedQrPose(text, observations, deps) → Pose | null` — the pose alone
  (`deriveQrPlacement(...)?.pose ?? null`).
- `createIncrementalQrPlacement(deps) → IncrementalQrPlacement` — the **stateful,
  incremental** variant for hot store-driven consumers. `update(text, observations)`
  folds in **only observations newer than the last fold** (O(1) per new detection)
  and returns the current `DerivedQrPlacement | null`; **F1 memo** — if the newest
  timestamp is unchanged it returns the cached placement without folding/solving.
  `reset(text)` drops a marker's accumulated size + memo. Equivalent to a full
  `deriveQrPlacement` replay over the same sequence (folds each obs once, in order,
  against its as-of depth), but avoids the O(history)-per-store-action cost that
  caused the on-device framerate ramp-down (perf-degradation follow-up / open topic D).
  **Fold cursor advances only past observations actually folded:** an observation
  whose as-of depth is not yet available (`resolveDepthAt` returns `null` — the
  depth stream is separate and may lag the QR stream) is skipped **without**
  consuming the cursor, so it is retried on a later `update` once its depth lands.
  In steady state (depth present) the cursor still reaches the newest timestamp, so
  the O(1)-per-detection cost is unchanged; only a transiently-depth-less tail is
  re-attempted (bounded by the gap).

## Invariants & assumptions

- **`resolveDepthAt` IS the as-of join** — "depth context active at this timestamp". The
  observation stays pure-raw; the depth grid lives in its own recorded stream
  (`recordDepthSample`), the single source of truth for _all_ sizing algorithms.
- **No `ar → state` import.** This module is structural; the `qrDetected` slice adapts
  `QrDetectionEntry → RawQrObservation` and delegates here. Keeps the cycle open.
- **Cost:** `deriveQrSizeM`/`deriveSolvedQrPose` re-run the whole history per call —
  O(history), bounded by the slice ring buffer. Cheap for v1; memoize if the debug-viz
  cadence makes it hot.
- Returns `null` rather than throwing on any failure (best-effort viz contract).

## Examples

```ts
const pose = deriveSolvedQrPose('https://x', observations, {
  resolveDepthAt: (t) => depthContextAt(t), // live: current sample; replay: recorded stream
  solver: new PlanarPnpSquare(),
});
```

## Tests

- `qr-derived-pose.test.ts` — null paths (empty/no-depth), single-observation solve with an
  exact solver, and the **end-to-end re-test guarantee**: a raw observation forward-projected
  from a known pose, with the real `PlanarPnpSquare` + a constant-depth context, re-derives
  that same world pose (live == replay by construction).
- `deriveQrPlacement` returns both the pose and the metric size for the same fixed marker.
- Slice-level mapping/guard: `state/qr-detected-slice.test.ts` (`selectSolvedQrPose` /
  `selectDerivedQrPlacement`).
