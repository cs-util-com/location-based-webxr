# editor3d-stations.ts

## Purpose

The tour in the 3D editor's world, read-only: every station at its point
with a billboard (its number and name); the stations near the camera's
centre and the selected one with their items drawn as the phone draws
them, their placed models, a ring for their found radius and a pole up to
the billboard; every code with a position as a square of its printed
size, facing as printed.

## Public API

- `StationsLayerDeps` - what the page hands in: `parent`, `ellipsoid`,
  `worldFromEcef`, `undulationAt`, `makeLabel`, `loadPhotoTexture`,
  `loadContent`, `loadGlbModel`, `makeBillboard`, `makeCodeSquare` (the
  drawing is the page's: Node, where the tests run, has no canvas).
- `StationsLayerView` - per frame: `centre` (the orbit's centre in the
  world), `selectedStation`, `standing` (`morphStanding`).
- `DEFAULT_CODE_SIZE_M` - 0.2; `BILLBOARD_LIFT_M` - 4.6 (how much higher a
  billboard stands upright than flat; flat it is 0.6 m over its station).
- `codeQuaternionNue(geo)` - a code's rotation in its north-up-east frame
  for a square whose printed face is +z: its full rotation when it has
  one, else the vertical poster of its heading (+x along the heading by
  `localPlaneToEnu`, +y up, the face at heading + 90 degrees).
- `createStationsLayer(deps)` -> `StationsLayer`:
  - `setTour(manifest, levels)` - when the document changes; a station
    whose place in the list and record are unchanged is not rebuilt;
  - `update(view)` - each frame: near-K (`nearStations`), the morph;
  - `stats()` - `{ stations, codes, shown, renders }`;
  - `pointOf(id)`, `billboardOf(id)`, `photoPlanes(id)`, `models(id)` - for
    the tests and the page's checks;
  - `dispose()` - everything out of the scene and freed.

## Invariants & assumptions

- **Heights:** each station's root is `pointRootMatrix` at its own point
  (drawn N lower than its ellipsoidal `alt`), its group at (0, alt, 0) as
  `renderTourStation` places it, so a station on the ground in the file
  stands on the drawn ground.
- **Near-K:** a station's items are rendered when it enters the near set
  and freed when it leaves; a render finishing after its station left is
  dropped. Every station keeps its billboard.
- **The morph:** photos slerp between flat face up (their heading kept)
  and their upright pose; billboards and poles rise with `standing`;
  models keep their pose. `renderTourStation` skips models, so the layer
  adds them at their pose, scaled to their size by `modelScale`; a model
  whose file cannot be read is left out.
- **Shared textures** (`userData.sharedMap`, the code face) are not freed
  with an object.
- **Writes nothing** to the tour or the store.
- **Not yet:** billboards are not decluttered, and photos are drawn at
  their own size, not scaled up to a readable size from far away.

## Examples

```ts
const layer = createStationsLayer({ parent: scene, ellipsoid, ...deps });
layer.setTour(manifest, levels);
renderer.setAnimationLoop(() => {
  layer.update({ centre: controls.target, selectedStation, standing });
});
```

## Tests

`editor3d-stations.test.ts` (a hand-made WGS84 ellipsoid, the licence's
store): each station at its drawn height where it stands; only the near
and selected stations rendered, and what leaves freed; a billboard per
station rising with the morph; photos flat looking down and upright
tilted; a model at its size and pose; a model that cannot be read left
out; every code as a square of its printed size; everything removed on
dispose; `codeQuaternionNue` for a heading and a full rotation. Real
drawing and real ground: `playwright-tests/editor3d.spec.js`.
