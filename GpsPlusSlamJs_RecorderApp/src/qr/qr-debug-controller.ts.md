# qr-debug-controller.ts

## Purpose

The WS-5 store-driven consumer: turns recorded RAW QR detections into the live +
replay debug axis+cube. Called on every store change, it renders — per marker —
the shared [`createQrDebugView`](../../../GpsPlusSlamJs_AppFramework/src/ar/qr/qr-debug-view.ts)
under `arWorldGroup` at the **derived** best-effort pose+size
(`selectDerivedQrPlacement`), and owns the as-of [depth resolver](qr-depth-resolver.ts).

Because it only reads the store, it runs IDENTICALLY live and on replay — replaying
a raw recording with a different size/PnP algorithm shows the new placement (the
maintainer's re-test goal, visualised).

## Public API

- `createQrDebugController(deps) → QrDebugController`
  - `deps.getState()` — the `{ qrDetected, recording.latestDepthSample }` subset.
  - `deps.getArWorldGroup()` — parent for debug objects (`null` until AR starts).
  - Optional seams (defaults in parens, overridable in tests): `resolver`
    (`createQrDepthResolver`), `solver` (`PlanarPnpSquare`), `createView`
    (`createQrDebugView`), `deriver` (`createIncrementalQrPlacement`),
    `selectObservations` (`selectQrRawObservations`), `sizeOptions`,
    `maxReprojectionErrorPx`.
  - `update()` — reconcile views with the current state (call per store change).
  - `dispose()` — tear down all views + reset the resolver.

- Dep `onObjectPlaced?`: handed to the default `createView` as the view's `onPlaced`. Each `view.update` passes the newest observation's timestamp as the capture time, because the placement pose is always the PnP solve of `observations.at(-1)`.

## Invariants & assumptions

- **Depth first:** each new `latestDepthSample` (identity change) is appended to
  the resolver BEFORE rendering, and even when `arWorldGroup` is still `null` — so
  the history is complete by the time AR starts.
- **Best-effort:** a marker that cannot be sized yet renders nothing (no throw); a
  transient miss does NOT clear an existing view (persistence across throttled
  detections). Views are disposed (and the deriver's per-marker state `reset`) only
  when their marker leaves the store (`clearQrMarker` / `clearAllQrMarkers`).
- **Incremental, not full-replay (perf-degradation fix):** placement comes from a
  persistent `createIncrementalQrPlacement` that folds only NEW observations per
  marker (O(1)/detection) and memoizes when nothing new arrived — NOT
  `selectDerivedQrPlacement` (O(history) per store action), which ramped the
  recorder framerate down on device. See [open topic D](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-18-0048-recorder-live-qr-perf-degradation-followup.md).
- **No self-subscription:** the controller never subscribes; `main.ts` calls
  `update()` from its existing store subscription (live) and replay drives the
  same store, so one wiring covers both.

## Tests

- `qr-debug-controller.test.ts` — renders a sizeable marker (pose+size); renders
  nothing when unsizeable; persists across a miss; disposes on marker removal;
  feeds the resolver before AR starts; identity de-dup of depth appends;
  `dispose()` tears down views + resets the resolver. PnP/size numerics are
  injected (covered by the framework tests).

- The capture time handed to `view.update` is the newest observation's, and the default view reports its placed objects through `onObjectPlaced`.

## Related

- [qr-depth-resolver.ts.md](qr-depth-resolver.ts.md) — the as-of join it drives.
- Wiring: `main.ts` (WS-2 producer + this subscriber).
