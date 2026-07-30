# qr-debug-view.ts

## Purpose

The shared 3D "is the QR glued to the printed code?" debug overlay: a 3D axis at
the solved QR pose plus a semi-transparent cube sized to the QR so its front face
lands on the printed corners. Promoted to the framework (recorder live-QR WS-5)
as the **shared consumer** — both the QR-tracking demo and the GPS Recorder
render it off the derived pose, live and on replay.

## Public API

- `createQrDebugView(parent: Object3D): QrDebugView`
  - Creates the axis + cube under `parent` (the `arWorldGroup`), hung off an
    internal `WEBXR_TO_NUE` basis node. Objects start **hidden**.
- `QrDebugView`
  - `update(pose: Pose, sizeM: number | null): void` — reveal + glue the axis to
    `pose`; show the cube scaled to `sizeM` (in-plane) only when `sizeM` is
    non-null, else keep the cube hidden (axis still shown).
  - `clear(): void` — hide both objects WITHOUT detaching (no flicker on a miss).
  - `dispose(): void` — detach the basis subtree and free GPU resources.

## Invariants & assumptions

- **Coordinate space:** the QR `pose` is in **raw WebXR** space (corners are
  depth-unprojected with the raw WebXR camera pose), but `parent` local space is
  **NUE**. The objects therefore hang off an internal node carrying
  `WEBXR_TO_NUE` (`matrixAutoUpdate = false`) so they ride the same basis the
  camera does. Parenting directly under `arWorldGroup` would axis-swap them
  (the recurring scene-frame bug — see frame-tile / occupancy-cube precedents).
- **Persistence:** `update()` is called per lock; `clear()` is NOT called on a
  miss, so the objects keep their last pose between throttled detections.
- **Best-effort cube:** until a measured `sizeM` exists the cube stays hidden
  rather than drawing a NaN/garbage-scaled box; the axis alone proves the glue.
- **Cube geometry:** a 1 cm-deep slab (`CUBE_DEPTH_M = 0.01`) scaled to
  `sizeM × sizeM` in-plane and pushed back by half its depth
  (`translateZ(-CUBE_DEPTH_M / 2)`), so its `+z` face lands exactly on the
  printed code rather than straddling it.
- Pure three.js — knows nothing about who solved the pose, so it runs identically
  live and on replay.

## Examples

```ts
import { createQrDebugView } from 'gps-plus-slam-app-framework/ar/qr/qr-debug-view';
const view = createQrDebugView(arWorldGroup);
// per store change, for a marker:
const pose = selectSolvedQrPose(state, text, deps); // null when not sizeable yet
if (pose) view.update(pose, deriveQrSizeM(...));
```

**Import via the deep subpath** (`…/ar/qr/qr-debug-view`), **not** the `…/ar`
barrel: the barrel eagerly evaluates heavy transitive dependencies, while this
module needs only the three-only `WEBXR_TO_NUE` constant. Both the Recorder and
the demo import it this way.

## Tests

- `qr-debug-view.test.ts` — 6 tests, against a real `THREE.Group` (no WebGL
  needed for transforms): starts hidden; rides the `WEBXR_TO_NUE` basis
  ([1,0,0] raw → world z=1); reveals + glues axis/cube at the measured size;
  axis-only when size unknown (no NaN scale); cube appears once a size arrives;
  `clear()` hides without detaching, `dispose()` detaches.

## History

Promoted from the QR-tracking demo into the framework (recorder live-QR WS-5).
The demo previously kept a byte-identical local copy at
`GpsPlusSlamJs_QrTrackingDemo/src/qr-debug-view.ts` with its own duplicate test;
both were deleted when the demo switched to this shared module, so the two apps
render the identical overlay and cannot diverge.

## Related

- [qr-derived-pose.ts.md](qr-derived-pose.ts.md) — derives the `Pose` rendered here.
- [webxr-nue-basis.ts](../webxr-nue-basis.ts) — the `WEBXR_TO_NUE` basis the objects ride.
- Recorder WS-5 subscriber: `GpsPlusSlamJs_RecorderApp/src/visualization/qr-debug-controller.ts`.
