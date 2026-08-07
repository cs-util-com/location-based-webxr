# ar/ar-session-resources.ts

## Purpose

Holds the live resources of one AR session as a single named record, so that
code outside `main.ts` can create and tear them down.

## Public API

- `ArSessionResources` — interface with seven nullable slots:
  - `mapOverlay: LeafletMapOverlay | null` — lazily created on the first map
    toggle, so it can stay `null` for a whole session.
  - `cameraFollower: CameraFollower | null` — GPS-aligned anchor; the map and
    compass cubes parent into its `object3D`.
  - `alignmentLerper: AlignmentLerper | null` — smooths alignment-matrix
    transitions on `arWorldGroup`.
  - `statsOverlay: PerfStatsOverlayHandle | null` — FPS/ms/MB panels, advanced
    once per rendered XR frame.
  - `loopClosureHandler: LoopClosureHandler | null` — rebound to the current
    store inside the per-frame callback.
  - `qrProducer: QrDetectionController | null` — RAW QR producer fed by the
    framework's camera-frame callback.
  - `refPointViews: RefPointViewWiring | null` — 3D spheres + live-map markers.
- `createArSessionResources(): ArSessionResources` — a record with every slot
  `null`. No error modes; it is a plain object literal.

## Invariants & assumptions

- **Read at fire time, never captured.** Consumers (per-frame callbacks,
  tracking callbacks, the recording handlers' `applyAlignmentMatrix`) are built
  _before_ the resources exist, so they must dereference
  `resources.<slot>` at call time. Copying a slot into a local variable that
  outlives the call breaks late wiring and strands disposed objects.
  The one legitimate exception is a synchronous narrowing local immediately
  after the slot was assigned (see the compass-cubes block in
  [`wire-ar-scene.ts`](wire-ar-scene.ts.md)).
- **Filling and emptying are paired at the creation site.** Whoever assigns a
  slot also registers a disposer with
  [`utils/ar-session-scope.ts`](../utils/ar-session-scope.ts.md) that nulls it
  again. Nothing in this module enforces that — the scope's reverse-order
  teardown does.
- **One record per app, reused across sessions.** Slots are emptied by
  teardown, not by allocating a new record, so long-lived holders of the
  record stay valid across Enter-AR cycles.
- `activeImageQualityAnalyzer` is deliberately absent: it is scoped to a
  _recording_, not to the AR session, and stays with its owner in `main.ts`.

## Examples

```ts
const resources = createArSessionResources();

// wiring side
resources.statsOverlay = createPerfStatsOverlay(appContainer);
scope.add('Stats overlay', () => {
  resources.statsOverlay?.dispose();
  resources.statsOverlay = null;
});

// consumer side — built earlier, reads later
const onFrame = () => resources.statsOverlay?.update();
```

## Tests

- `ar-session-resources.test.ts` — every slot starts `null`; a reader built
  before wiring observes a later write and the teardown that nulls it again;
  each call returns an independent record.
- The behaviour that actually depends on this record is covered by the
  `main.*-wiring.test.ts` suites (follower, occupancy cubes, visualization
  toggles, loop closure, map toggle, QR), which drive full Enter-AR cycles.
