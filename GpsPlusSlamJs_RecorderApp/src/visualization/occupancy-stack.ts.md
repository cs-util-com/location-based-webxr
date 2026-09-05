# occupancy-stack.ts

## Purpose

Builds the occupancy stack — `OccupancyGrid` + optional `OccupancyCubesVisualizer` + optional persistent occluder (`occluder-sink.ts`) + the store feed (`wire-occupancy-grid-subscribers.ts`) — once, for both the live AR scene (`ar/wire-ar-scene.ts`) and the replay scene (`replay/replay-mode.ts`). Until 2026-09-04 each call site built the stack inline and replay kept parity with live by comment; the two sites differ in two inputs, which are the parameters here.

## Public API

- `wireOccupancyStack(deps: OccupancyStackDeps): OccupancyStackHandle`
  - `deps.arWorldGroup` — the alignment-riding parent (never the scene root: cells are raw WebXR coordinates).
  - `deps.storeRef`, `deps.occupancy` (the options group as the call site sourced it), `deps.depthIntervalMs` (the cube-refresh throttle follows the depth cadence).
  - `deps.showCubes` — live: the `occupancyCubes` toggle; replay: `true`. OFF wires a no-op visualizer sink so the grid is still fed (non-visualizer consumers read it) without allocating an `InstancedMesh`.
  - `deps.logContext` — appended to the grid-update error log (`'during replay'`).
  - Returns `{ grid, dispose }`. `dispose()` unsubscribes the feed FIRST, then releases the cubes and the occluder it fed.

## Invariants & assumptions

- **One expression for the shared numbers.** The carve threshold and the cube noise floor are both `occupancy.minConfidence`; the camera-move epsilon is `16 · cellSizeM` (one chunk edge) and is set only when a camera-relative window exists (cubes on, or the occluder with `occluderRadiusM > 0`); the refresh throttle is `depth.intervalMs`. These used to be maintained in two copies.
- **Where the options come from is the call site's decision.** Live snapshots them at Enter-AR; replay re-reads `loadRecordingOptions()` per replay so an old recording re-quantizes at the current setting. This module never reads storage.
- **Publishing the grid stays at the LIVE call site** (`occupancy-grid-provider`): only the live grid feeds the COLMAP export, and the provider is a module-level singleton replay must not clobber.
- No input validation beyond what the constructors do: the options group arrives already clamped by `recording-options.ts`.

## Example

```ts
const stack = wireOccupancyStack({
  arWorldGroup,
  storeRef,
  occupancy: options.occupancy,
  depthIntervalMs: options.depth.intervalMs,
  showCubes: options.visualization.occupancyCubes,
});
setOccupancyGrid(stack.grid); // live only
// ...
stack.dispose();
setOccupancyGrid(null);
```

## Tests

- `occupancy-stack.test.ts` — the option mapping for both variants (cubes on/off, occluder on/off with and without a window), the no-op sink when cubes are off, the log context, the dispose order (feed, cubes, occluder), and the disposal of the cubes and the occluder when the subscriber wiring throws (both call sites swallow that throw and never receive the handle; the pre-extraction replay code disposed them from outer scope — PR #413 review).
- The call sites are pinned by `main.occupancy-cubes-wiring.test.ts` (live) and `replay/replay-mode.test.ts` (replay), which mock the same framework classes and local wirers this module imports.
