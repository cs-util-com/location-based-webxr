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
arWorldGroup, getOccluder, ballCount, getCamera }`. Returns
  `{ update(), isActive(), dispose() }`:
  - `update()` per frame, before the render: centre = the camera's position
    in `arWorldGroup`'s frame, `FLOOR_BELOW_CAMERA_M` (1.4 m) lower;
    `casterCount` = `ballCount()`;
  - `dispose()` restores the light's parent and position and its target's,
    and the rig restores the light's shadow settings. Idempotent.
  - Returns an INERT handle (no shadow map turned on) when the scene has no
    `SCENE_NODE.SUN_LIGHT` directional light, or when it does not shine from
    above in the room's frame.
- `shadowsEnabledFromSearch(search)` - false for `shadows=0`, `off` or
  `false`; true otherwise.
- `shadowsLabel(shadows)` - `" · shadows on"` while shadows are drawn, else
  `""` (the stats line; the e2e reads it).
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
