# ar/wire-ar-space-correction.ts

## Purpose

After an ARCore relocalization, the AR odometry frame jumps and content placed before the jump sits off its physical place. This module moves that content back. It is the RecorderApp's one wiring of the framework's content watcher (`gps-plus-slam-app-framework/ar/ar-content-watcher`, `enableArSpaceCorrection`), built by the live AR scene (`wire-ar-scene.ts`) and by each replay (`replay/replay-mode.ts`), so live and replay share one code path.

The relocalization feed records each observation into the store whether this module is on or off; the store derives the correction (the bake model: each later jump is applied once to the content's local pose); this module only applies it to scene objects.

## Public API

- `wireArSpaceCorrection({ arWorldGroup, storeRef, enabled }): ArSpaceCorrectionWiring`
  - `arWorldGroup`: the alignment-riding node whose local space is AR odometry.
  - `storeRef`: the recorder store reference; the watcher follows each store a new recording swaps in. Replay passes a fixed one.
  - `enabled`: `arSpaceCorrection.applyEnabled`, read once by the caller.
- `ArSpaceCorrectionWiring`
  - `arContent: THREE.Group | null`: a group under `arWorldGroup` whose children are corrected by themselves (the fused GPS markers go here). `null` when off.
  - `onPlaced: ArContentPlacedHook | undefined`: report an object whose raw pose was just written, for content that stays under its own framework node of `arWorldGroup` (frame tiles, QR debug axis and cube). `undefined` when off, so callers pass nothing on.
  - `dispose()`: stop correcting, stop following the store, remove `arContent`. Idempotent.
- `ArContentPlacedHook = (object, capturedAt?) => void`: `capturedAt` is the capture time of the data the pose came from, in the epoch-ms XR clock (`performance.timeOrigin + XRFrame time`, the clock of the relocalization observations and of `image.timestamp`); omitted means "now".

## Invariants and defensive measures

- **Each `onPlaced` call restarts the placement** (`untrack`, then `track` with the capture time): the raw pose was just rewritten, so the jumps applied to the old one no longer describe it. The QR cube is rewritten every frame from older observations and is re-dated on each write.
- **Time runs forward:** content is reported before any later observation is dispatched, so `capturedAt` is never after an observation that is already in the store but newer than it. The feed dispatches in the jump frame before that frame's captures run, which keeps this true live and in replay. The property test pins exactly this precondition.
- **Failure never breaks drawing:** if the watcher cannot be built, a warning is logged and the wiring is off (content drawn, not corrected). A failing `onPlaced` is caught and warned about once per wiring (the QR cube is placed every frame).
- **State placement:** the correction is read from the store's selectors only. The listeners, the registry and `arContent` are imperative three.js state and live outside the store.
- **Teardown order:** callers register it on the session scope before the content that uses it, so it is disposed after that content.

## Examples

```ts
const correction = wireArSpaceCorrection({
  arWorldGroup,
  storeRef,
  enabled: options.arSpaceCorrection.applyEnabled,
});
if (correction.arContent) {
  gpsEventVisualizer.setSceneSource({
    getScene,
    getArWorldGroup: () => correction.arContent,
  });
}
wireFrameTileStack({ /* ... */ onPlaced: correction.onPlaced });
scope.add('AR-space correction', () => correction.dispose());
```

## Tests

- `wire-ar-space-correction.test.ts` (real recorder store, real marker, tile and QR visualizers):
  - fused GPS markers placed before a jump move back; markers placed after it do not;
  - a tile captured before a jump but added after it takes the jump once; one captured after does not;
  - the QR axis and cube, rewritten each frame from an older observation, take only the jumps after that observation;
  - after a store swap, the old store's jumps move nothing and the new store's jumps apply once, also to new tiles;
  - off returns no group and no hook; dispose removes the group and stops correcting; a watcher that throws leaves the wiring off with a warning; a failing hook is caught and warned about once.
- `wire-ar-space-correction.property.test.ts`: random interleavings of jumps (over 1 m, at least 200 ms apart), tile adds and QR rewrites; every tile and QR object ends on its raw pose premultiplied by exactly the jumps observed after its capture time. The oracle composes the raw jumps itself.
