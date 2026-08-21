# billboard-interaction.ts

## Purpose

Pointer picking for a clickable billboard (view layer): raycasts a
billboard's sprite + panel meshes on a tap and reports a classified hit — a
sprite hit (by id) or a panel hit (by id + local UV, which `panel-layout.ts`
turns into a toggle/seek intent). The tap-vs-drag guard and raycast
mechanics live in `pointer-tap-picker.ts` (shared with any other in-world
pickable content); this module owns only the billboard `userData`
interpretation.

## Public API

- **`createBillboardInteraction(options: PointerTapPickerTargetOptions & { onSpriteClick(id): void; onPanelHit(id, uv: { u, v }): void }): { dispose(): void }`**
  — wraps `createPointerTapPicker`; reads each hit's `userData` as
  `BillboardUserData` and routes to `onSpriteClick` (role `'sprite'`) or
  `onPanelHit` (role `'panel'`), ignoring hits with no `billboardId`.

## Invariants & assumptions

- A hit whose `userData.billboardId` is `undefined` is ignored (not every
  pickable mesh in a scene is necessarily a billboard mesh).
- Depends on `pointer-tap-picker.ts` and the `BillboardUserData` type from
  `clickable-billboard.ts`.

## Examples

```ts
import { createBillboardInteraction } from 'gps-plus-slam-app-framework/visualization';

const interaction = createBillboardInteraction({
  domElement: renderer.domElement,
  camera,
  getPickTargets: () => billboards.flatMap((b) => b.getPickTargets()),
  onSpriteClick: (id) => dispatch({ type: 'click', id }),
  onPanelHit: (id, uv) => {
    const action = hitToAction(uv);
    if (action) dispatch(action);
  },
});
```

## Tests

- Not unit-tested (thin routing over `pointer-tap-picker.ts`, itself covered
  by `pointer-tap-picker.test.ts`); exercised manually via the consuming
  demo.
