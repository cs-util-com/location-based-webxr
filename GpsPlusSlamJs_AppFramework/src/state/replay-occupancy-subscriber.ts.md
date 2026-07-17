# replay-occupancy-subscriber.ts

## Purpose

Folds a replayed depth-sample stream into an occupancy grid and drives its
visualizers on a throttle, for the **single-store** desktop replay case used by
`startReplaySession`. It observes one store's `recording.latestDepthSample` by
reference, folds each new sample into the grid, and refreshes the caller's
visualizers on a leading+trailing throttle (replay re-dispatches samples far
faster than the ~2 Hz live cadence, so an un-throttled refresh would rebuild the
cubes/mesh on every action).

Deliberately a **leaner sibling** of the RecorderApp's
`visualization/wire-occupancy-grid-subscribers.ts`: no `StoreRef`/store-swap, no
cells-over-time telemetry, no revision/camera-move skip guard — a fresh replay
consumer needs none of those. Unifying the two (promoting the recorder's wirer +
`store-ref` into the framework and generalizing the store type) is a deliberate
Part A follow-up.

## Public API

- **`subscribeReplayOccupancy(options): () => void`** — attaches the
  subscription; the returned function detaches it and cancels any pending
  trailing refresh.
  - `options.store: DepthSampleStore` — the single replay store (structural type:
    `getState().recording.latestDepthSample` + `subscribe`). Satisfied by both
    `SlamAppStore` and `RecorderStore`.
  - `options.grid: OccupancyGridSink` — `{ addSample, clear }`; each new sample is
    folded via `addSample`.
  - `options.onRefresh(viewerPose?)` — redraw the visualizers from the updated
    grid; receives the newest sample's head pose (raw WebXR) for over-cap
    nearest-N cube selection. Errors routed to `onError`.
  - `options.refreshIntervalMs?` — min delay between refreshes (default 250).
  - `options.onError?` — best-effort sink for a throwing `addSample`/`onRefresh`.

## Invariants & assumptions

- **Every sample is folded** into the grid (no geometry lost), but refreshes are
  **coalesced**: the first sample after a quiet period refreshes immediately
  (leading edge); a burst schedules exactly one trailing refresh per interval so
  the final settled state is always drawn.
- **Seed:** a sample already present in the store at subscribe time is folded once.
- **Freshest pose wins:** the trailing refresh uses the newest sample's head pose
  even if intermediate samples were throttled.
- **Defensive:** a throwing `addSample` or `onRefresh` is routed to `onError` and
  never breaks the store subscription; a throwing `onError` is swallowed.
- **Single store only** — it does not follow store swaps (the replay session owns
  exactly one store). Wall-clock throttle via `Date.now`.

## Examples

```ts
const dispose = subscribeReplayOccupancy({
  store,
  grid,
  onRefresh: (pose) => {
    cubes.refresh(grid, pose);
    occlusionMesh.update(grid.getOccupiedCells(1), 0.15, (c) =>
      grid.getCellPoint(c)
    );
  },
});
// ... replay ...
dispose();
```

## Tests

- `replay-occupancy-subscriber.test.ts` — leading-edge refresh on the first
  sample (with pose); a burst folds every sample but coalesces to one trailing
  refresh (newest pose); seed sample folded on subscribe; dispose cancels the
  pending refresh and detaches; a throwing `addSample` routes to `onError` while
  the subscription survives. Uses vitest fake timers to pin the throttle.
