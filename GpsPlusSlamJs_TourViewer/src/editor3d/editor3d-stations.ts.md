# editor3d-stations.ts

## Purpose

The tour in the 3D editor's world: every station at its point
with a billboard (its number and name); the stations near the camera's
centre and the selected one with their items drawn as the phone draws
them, their placed models, a ring for their found radius and a pole up to
the billboard; every code with a position as a square of its printed
size, facing as printed. It writes nothing: while a gesture runs it
draws the gesture's preview (`setPreview`), and it says what is under a
ray (`pick`).

## Public API

- `StationsLayerDeps` - what the page hands in: `parent`, `ellipsoid`,
  `worldFromEcef`, `undulationAt`, `makeLabel`, `loadPhotoTexture`,
  `loadContent`, `loadGlbModel`, `makeBillboard`, `makeCodeSquare` (the
  drawing is the page's: Node, where the tests run, has no canvas).
- `StationsLayerView` - per frame: `centre` (the orbit's centre in the
  world), `selectedStation` (the selected station, or the selected item's),
  `stationSelected` (the selection is that station itself), `standing`
  (`morphStanding`), `camera` (the camera's position in the world).
- `LayerPreview` - `{ kind: "station", id, geo, foundRadiusM }` or
  `{ kind: "item", id, geo, sizeM }` (ellipsoidal geo poses, as the file).
- `DEFAULT_CODE_SIZE_M` - 0.2; `BILLBOARD_LIFT_M` - 4.6 (how much higher a
  billboard stands upright than flat; flat it is 0.6 m over its station);
  `CODE_FLAT_GAP_M` - 0.07 (the gap between a code's anchor and the near
  edge of the code laid flat); `CODE_READABLE_M` - 1 / 0.014, about
  71.4 m, and `CODE_GROWTH_MAX` - 8 (see `codeGrowth`).
- `codeGrowth(distanceM, standing)` - how many times its printed size a
  code is drawn: the distance over `CODE_READABLE_M`, between 1 and 8,
  weighted by how flat it lies (`1 - standing`). A distance or morph that
  is not a finite number, or a negative distance, gives 1; a morph past 0
  or 1 is taken at that end.
- `codeQuaternionNue(geo)` - a code's rotation in its north-up-east frame
  for a square whose printed face is +z: its full rotation when it has
  one, else the vertical poster of its heading (+x along the heading by
  `localPlaneToEnu`, +y up, the face at heading + 90 degrees).
- `createStationsLayer(deps)` -> the layer:
  - `setTour(manifest, levels)` - when the document changes; a station
    whose place in the list and record are unchanged is not rebuilt;
  - `update(view)` - each frame: near-K (`nearStations`), the morph;
  - `stats()` - `{ stations, codes, codeScales, shown, renders }`
    (`codeScales`: each code's drawn size over its printed one);
  - `pointOf(id)`, `billboardOf(id)`, `photoPlanes(id)`, `models(id)` - for
    the tests and the page's checks;
  - for the flights: `radiusOf(id)` (a station's found radius),
    `itemPointOf(id)` (an item's place in the world, its station drawn or
    not), `codePointOf(levelId)` (a code's centre); each null for an id
    the tour does not have;
  - `setPreview(preview | null)` - a `LayerPreview` shown in place of the
    tour's pose until null: a station's place (its billboard, ring, items
    and models follow) and found radius, or an item's place (a model also
    its size); the tour as drawn is untouched and comes back on null;
  - `pick(raycaster)` - the nearest visible thing under the ray: a
    station's billboard (`station:<id>`), an item's label, plane or model
    (its object id) or a code's square (its level id); null for none;
  - `setShown({ names, codes })` - the billboards and poles, and the code
    squares, off or on (the layer chips); `codesVisible()`;
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
  and their upright pose; codes too, by the shortest turn to face up (a
  code measured lying face up keeps its pose, so its pattern never
  spins), their middle moved level along the side their face looks to,
  half the code plus `CODE_FLAT_GAP_M` out, so a code on a wall lies in
  front of it and never under it; a code's point (`codePointOf`, what a
  flight frames) stays its anchor.
- **Codes grow from far away:** laid flat, a code is drawn
  `codeGrowth(distance from the camera to its anchor, standing)` times
  its printed size - the storyboard prototype's curve (the distance times
  0.014, between 1 and 8): identical within about 71 m, 8 times from
  about 571 m. The square and its gap grow together, so its near edge is
  the grown gap off the anchor and a code on a wall still lies in front of
  it. Picking reads the drawn square, so a click anywhere on the grown
  code selects it (up to 1.6 m a side for a 20 cm code). It lies on the
  ground, so what stands over it (a billboard, a pin, a photo or a model)
  is hit first from above; what it can take is a click on bare ground
  beside a code. Codes have no gizmo; their point and the inspector's
  printed size do not change. Tilted up, a code is its printed size. Billboards and poles rise with
  `standing`; models keep their pose, and pins stand. `renderTourStation` skips models, so the layer
  adds them at their pose, scaled to their size by `modelScale`; a model
  whose file cannot be read is left out.
- **The found-radius circle** is the selected station's ring: amber (the
  gizmo's colour, its radius dots sit on it) while the station itself is
  selected, a lighter blue while an item in it is, else blue.
- **Shared textures** (`userData.sharedMap`, the code face) are not freed
  with an object.
- **Writes nothing** to the tour or the store; a preview moves only the
  drawn objects, and is re-applied after a station's items render.
- `pick` is by distance along the ray (the nearest hit wins), not
  billboards first.
- **Not yet:** billboards are not decluttered, and photos are drawn at
  their own size, not scaled up to a readable size from far away.

## Examples

```ts
const layer = createStationsLayer({ parent: scene, ellipsoid, ...deps });
layer.setTour(manifest, levels);
renderer.setAnimationLoop(() => {
  layer.update({
    centre: controls.target,
    selectedStation,
    stationSelected,
    standing,
    camera: camera.position,
  });
});
```

## Tests

`editor3d-stations.test.ts` (a hand-made WGS84 ellipsoid, the licence's
store): each station at its drawn height where it stands; only the near
and selected stations rendered, and what leaves freed; a billboard per
station rising with the morph; photos flat looking down and upright
tilted; a model at its size and pose; a model that cannot be read left
out; every code as a square of its printed size, laid flat face up in front
of its anchor looking down and upright tilted, and one lying face up
left as it lies; a code laid flat grown with the camera's distance (its
gap with it, picked at its grown size, printed size near or tilted up); where an item and a
code stand, drawn or not; a station's and an item's (a model's) preview
shown and taken back; the selected station's circle amber and a selected
item's station lighter; what is under a ray; names and codes hidden and shown; everything removed on
dispose; `codeQuaternionNue` for a heading and a full rotation;
`codeGrowth`'s curve, its flat weighting, bad input, and a property (1 to
8, growing with distance, shrinking as the view tilts up). Real
drawing and real ground: `playwright-tests/editor3d.spec.js`.
