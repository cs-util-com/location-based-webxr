# frame-tile-stack.ts

## Purpose

Builds the frame-tile stack — a `FrameTileVisualizer` under the alignment-riding parent plus the `wire-frame-tile-subscribers.ts` feed that decodes each captured frame into a textured plane — once, for both the live AR scene (`ar/wire-ar-scene.ts`) and the replay scene (`replay/replay-mode.ts`). Until 2026-09-04 both sites carried the decode + error wiring in two copies.

## Public API

- `wireFrameTileStack(deps: FrameTileStackDeps): () => void`
  - `deps.arWorldGroup` — the alignment-riding parent, never the scene root (tile poses are raw WebXR).
  - `deps.storeRef`, `deps.blobSource` (live: the capture cache; replay: the ZIP), `deps.divisor` (`frameTileDisplay.divisor`, the display-texture downscale).
  - `deps.maxTiles` — LIVE-ONLY FIFO cap. When omitted the visualizer is constructed with no options object at all (the replay test pins the one-argument call), so the full recorded path stays visible for coverage auditing.
  - Returns the teardown: unsubscribe, then dispose the visualizer.

## Invariants & assumptions

- Decode failures are logged and skipped (`Frame tile decode failed for "<file>"`); the feed continues.
- Where the divisor comes from is the call site's decision: live snapshots it at Enter-AR, replay re-reads it per replay.
- No validation of `divisor` here — it arrives clamped from `recording-options.ts`.

## Example

```ts
const dispose = wireFrameTileStack({
  arWorldGroup,
  storeRef,
  blobSource: (imageFile) =>
    Promise.resolve(liveFrameBlobs.get(imageFile) ?? null),
  divisor: options.frameTileDisplay.divisor,
  maxTiles: options.frameTileDisplay.maxTiles, // live only
});
```

## Tests

- `frame-tile-stack.test.ts` — the visualizer's parent and cap (one-argument construction when uncapped), the decode divisor, the error log, and the teardown order.
- The call sites are pinned by `main.visualization-toggles-wiring.test.ts` (live) and `replay/replay-mode.test.ts` (replay).
