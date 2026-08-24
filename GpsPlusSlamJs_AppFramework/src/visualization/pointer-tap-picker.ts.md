# pointer-tap-picker.ts

## Purpose

Tap-vs-drag-gated raycast picking, shared by any component whose desktop
interaction is "click a mesh, get the hit" (an in-world billboard, an
in-world text panel). The tap-vs-drag decision itself is the pure `isTap`
gate in `tap-gate.ts`; a WebXR consumer can swap this `pointerup`-raycast for
the XR `select` ray while keeping the same downstream hit handling.

## Public API

- **`PointerTapPickerTargetOptions`** — `{ domElement, camera, getPickTargets }`,
  the raycast target set every interaction wrapper takes.
- **`createPointerTapPicker(options: PointerTapPickerTargetOptions & { onTap: (hit: Intersection<Object3D>) => void }): { dispose(): void }`**
  — attaches `pointerdown`/`pointerup`/`pointercancel` listeners to
  `domElement`; on a gesture that passes `isTap`, raycasts
  `getPickTargets()` from `camera` and calls `onTap` with the nearest hit (a
  miss is silently dropped). `dispose()` removes the listeners.

## Invariants & assumptions

- Multi-touch safe: only one pointer is tracked as a potential tap, keyed by
  `pointerId`. A second concurrent `pointerdown` (a pinch/rotate gesture) or a
  `pointercancel` invalidates the pending gesture, so a finger lifting
  mid-pinch can never fire a phantom tap against the wrong down-coordinates.
- Owns raycast mechanics only — interpreting the hit's `userData` (which
  mesh, which role) is each caller's own concern via `onTap`.
- Depends on `three` and `tap-gate.ts`.

## Examples

```ts
import { createPointerTapPicker } from 'gps-plus-slam-app-framework/visualization';

const picker = createPointerTapPicker({
  domElement: renderer.domElement,
  camera,
  getPickTargets: () => [spriteMesh, panelMesh],
  onTap: (hit) => console.log('tapped', hit.object.userData),
});
// later
picker.dispose();
```

## Tests

- `pointer-tap-picker.test.ts` — headless: synthetic pointer events against a
  fake element and real `Raycaster`/meshes, pinning the multi-touch/cancel
  invalidation, the tap-vs-drag/long-press gate wiring, the client→NDC
  mapping, and nearest-hit selection.
