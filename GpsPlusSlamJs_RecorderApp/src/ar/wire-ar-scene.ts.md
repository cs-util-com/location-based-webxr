# ar/wire-ar-scene.ts

## Purpose

Attaches the recorder's scene content — visualizers, the occupancy grid,
occluders, ref-point views and QR recording — to the Three.js objects that
`initAR` produced. It is the second half of Enter-AR; `main.ts` keeps the
session negotiation and the user-facing status/error paths.

## Public API

- `wireArScene(deps: WireArSceneDeps): void` — wires every block and returns
  nothing. Teardown is not returned either: each block registers its own
  disposer with the injected scope.
- `WireArSceneDeps`:
  - `arWorldGroup: THREE.Group` — alignment-following group; all raw-WebXR
    content (frame tiles, occupancy cubes, occluders, QR) parents here.
  - `arScene: THREE.Scene` — scene root; only the GPS-aligned, non-rotating
    camera follower parents here.
  - `appContainer: HTMLElement` — the `#app` dom-overlay root the stats
    overlay composites into.
  - `options: RecordingOptions` — read once, at call time (see below).
  - `scope: ArSessionScope` — teardown registry.
  - `resources: ArSessionResources` — slots this function fills.
  - `storeRef: StoreRef<RecorderStore>` — follows per-recording store swaps.
  - `liveFrameBlobs: FrameBlobCache` — blob source for the live frame tiles.

Error modes: gated blocks go through `scope.wire(name, enabled, factory)`,
which swallows a factory throw as a warning — a failed block is skipped and
the session continues without it. The two ungated blocks (alignment lerper,
camera follower) construct directly and will propagate a throw to
`handleEnterAR`'s catch, which surfaces an error and ends the XR session.

## Invariants & assumptions

- **Called only when both scene handles are non-null.** `main.ts` guards on
  `arWorldGroup && arScene`; this module does not re-check.
- **Read-once options.** Every `options` value is read at Enter-AR, never per
  frame. Toggling a setting mid-session therefore applies on the _next_
  Enter-AR — the documented behaviour of the `visualization` group. Replay is
  never gated by these toggles.
- **Ordering matters in two places.** The camera follower must be created
  before the compass cubes (they parent into its `object3D`), and inside the
  occupancy teardown the subscriber is unsubscribed before the visualizer and
  occluder it feeds are disposed, with `setOccupancyGrid(null)` last.
  `ArSessionScope` unwinds in reverse registration order, which preserves the
  first of these for free.
- **The occupancy grid is always built** (`scope.wire('Occupancy grid', true,
…)`); the `occupancyCubes` toggle gates only the rendered `InstancedMesh`.
  COLMAP export and other non-visualizer consumers read the grid through
  `getOccupancyGrid()`, so a no-op sink is wired when the cubes are off.
- **Parenting rule:** anything whose coordinates are raw-WebXR must hang off
  `arWorldGroup`, not the scene root, so it rides the alignment matrix like
  the camera does. Only the camera follower is deliberately at scene root.
- **Data-only deps.** There are no UI callbacks in `WireArSceneDeps`; anything
  that talks to the user belongs on the `main.ts` side of the seam. Keep it
  that way — a `showError` dep here would re-merge the two halves.

## Examples

```ts
const arWorldGroup = getArWorldGroup();
const arScene = getScene();
if (arWorldGroup && arScene) {
  wireArScene({
    arWorldGroup,
    arScene,
    appContainer,
    options: recordingOptions,
    scope: arSessionScope,
    resources: arSessionResources,
    storeRef,
    liveFrameBlobs,
    onQrLevelState: (text, state) => qrHud.noteLevelState(text, state),
  });
}
```

## Tests

Covered end-to-end through `main.ts`'s Enter-AR path rather than directly, by
the wiring suites that already pin this behaviour:

- `main.ar-follower-wiring.test.ts` — follower/lerper creation and parenting.
- `main.occupancy-cubes-wiring.test.ts` — grid always built, cube gating,
  no-op sink, teardown order, `refreshOnCameraMoveM` / `refreshIntervalMs`.
- `main.visualization-toggles-wiring.test.ts` — each `visualization` toggle's
  effect and its read-once-at-Enter-AR semantics.
- `main.qr-wiring.test.ts` — QR producer wiring and teardown.
- `main.map-toggle-wiring.test.ts` — ref-point views' `getMap` seam.
- `utils/ar-session-scope.test.ts` — the teardown semantics this module leans
  on (reverse order, once-only, throw isolation).
