# ar-shadows-wiring.ts

## Purpose

AR shadows in the PhysicsDemo (W4 AR shadows plan
`GpsPlusSlamJs_Docs/docs/2026-09-26-0549-ar-shadows-on-occlusion-mesh-plan.md`,
M3, §11): the thrown balls cast onto the reconstructed room, in live AR and
in the desktop replay. The framework's `createArShadows` does the work
(receiver, rig, the map re-render rule); this module wires the demo's scene
to it.

## Public API

- `startDemoShadows(deps): DemoShadows` - `deps` is `{ renderer, scene,
arWorldGroup, getOccluder, ballCount, getCamera }`; `getCamera` returns the
  viewer, any object (AR: the tracked camera; the replay: the recorded phone
  pose). Returns `{ update(), isActive(), inRange(worldPosition),
setEnabled(on), isEnabled(), dispose() }`:
  - `update()` per frame, before the render: centre = the camera's position
    in `arWorldGroup`'s frame, `FLOOR_BELOW_CAMERA_M` (1.4 m) lower;
    `casterCount` = `ballCount()`;
  - `inRange(p)`: whether a WORLD position lies within the shadow's reach,
    the square's half width (`AR_SHADOWS.halfWidthM`, 5 m) of the last
    update's centre, measured flat in the room's frame (a circle inside the
    square, so it never over-promises); the status line counts it;
  - `setEnabled(on)` is the owner's switch (round-2 plan 2026-09-26-2055
    M1): the framework's `ArShadows.setEnabled`, by the shadow's intensity
    only, never `castShadow` or the shadow map, so no material recompiles;
    `isEnabled()` reads it back;
  - `dispose()` restores the light's parent and position and its target's,
    and the rig restores the light's shadow settings. Idempotent.
  - Returns an INERT handle (no shadow map turned on, the switch still
    answering) when the scene has no `SCENE_NODE.SUN_LIGHT` directional
    light, or when it does not shine from above in the room's frame.
- `bindShadowSwitch(shadows, initialOn, toggle)` - one binding for AR and
  the replay: sets the page's initial state (`?shadows=`), mirrors it on the
  panel's toggle when there is one, follows the toggle both ways; returns
  the release.
- `shadowsEnabledFromSearch(search)` - false for `shadows=0`, `off` or
  `false`; true otherwise.
- `shadowsLabel(shadows)` - the stats line's note, the owner's view on the
  phone: `" · shadows on"` while drawn, `" · shadows off"` when switched
  off, `" · shadows unavailable"` when switched on but not drawn (no light
  from above, or the renderer's rule says no), `""` with no shadows at all.
- `FLOOR_BELOW_CAMERA_M` - 1.4 m.

## Invariants & assumptions

- **The frame:** the framework's `SUN_LIGHT` starts at the scene root, while
  the room mesh and the balls hang under `arWorldGroup`, which receives the
  GPS/AR alignment. The light AND its target move under `arWorldGroup`,
  keeping the world direction they had then, so a heading correction turns
  the light with the room instead of swinging the shadows across it. The
  target must share the light's parent: the rig writes both positions in one
  frame.
- The direction is fixed for the session (`createArShadows` reads it once).
- The occluder is looked up every frame through `getOccluder`, because the
  occupancy view's `setMeshMode` recreates it.
- `dynamicCasters: true`: the map re-renders every frame while balls exist,
  and once more when the last one goes.
- `enableSunShadows` switches the renderer to PCF shadow maps. When a session
  already renders, the lit materials recompile once.

## Examples

```ts
const shadows = startDemoShadows({
  renderer,
  scene,
  arWorldGroup,
  getOccluder: () => occupancy.getOcclusionMesh(),
  ballCount: () => runtime.ballCount(),
  getCamera,
});
// each frame, after runtime.step(): shadows.update();
// teardown: shadows.dispose();
```

## Tests

`ar-shadows-wiring.test.ts` (real three objects and framework modules, a stub
renderer): the shadow map and receiver switch on; the light turns with
`arWorldGroup`; the square is centred under the camera in the room's frame;
the receiver follows a recreated occluder; the map re-renders while balls fly
and once after; dispose restores the light; a scene without the light stays
off; the URL flag and the label. The seams in `ar-mode.test.ts` and
`replay-physics.test.ts`; the replay e2e checks the stats line.
