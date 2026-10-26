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
  (`morphStanding`), `camera` (the camera's position in the world),
  `viewportPx` and `fovDeg` (the view's height in CSS px and the camera's
  vertical lens: what a code's size on screen is worked out from).
- `LayerPreview` - `{ kind: "station", id, geo, foundRadiusM }` or
  `{ kind: "item", id, geo, sizeM }` (ellipsoidal geo poses, as the file).
- `DEFAULT_CODE_SIZE_M` - 0.2; `BILLBOARD_LIFT_M` - 4.6 (how much higher a
  billboard stands upright than flat; flat it is 0.6 m over its station);
  `CODE_FLAT_GAP_M` - 0.07 (the gap between a code's anchor and the near
  edge of the code laid flat); `CODE_SCREEN_PX` - 12, the least side in
  CSS px a code laid flat is drawn on screen (see `codeGrowth` and the
  sweep below).
- `focalPxOf(viewportPx, fovDeg)` - the view's pixels per radian straight
  ahead (half its height over the tangent of half the lens): about 965
  for a 900 px high view through 50 degrees, 418 for 390 px.
- `codeGrowth(distanceM, standing, sizeM, focalPx)` - how many times its
  printed size a code is drawn: laid flat, `CODE_SCREEN_PX * distanceM /
(sizeM * focalPx)`, never below 1 (where the printed size reads larger
  on screen, it is kept), no cap; weighted by how flat it lies (`1 -
standing`). A distance, size or focal length that is not a positive
  finite number (a distance of 0 gives 1), or a morph that is not a
  number, gives 1; a morph past 0 or 1 is taken at that end.
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
  - `codeCorners()` - each code's drawn square as its four corners in
    the world, in order around it (the page projects them to measure the
    code on screen);
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
- **Codes keep a size on screen from far away:** laid flat, a code is
  drawn `codeGrowth(distance from the camera to its anchor, standing,
printed size, focalPxOf(view))` times its printed size: `CODE_SCREEN_PX`
  (12 px) on screen wherever its printed size would read smaller, its
  printed size nearer (a 20 cm code grows from about 17 m on a 1440 x 900
  view, 16 m on a 390 x 844 phone, 7 m on a phone held sideways), no
  cap to the camera's 1100 m. The distance is to the anchor, so a code
  off the middle of a top view reads larger than 12 px by its distance
  over its depth: about 1.25 times at a 1440 x 900 view's side edge,
  1.33 in its corner.
  It shows where a code is and its three finder squares (about 3.4 px
  each); no size this small shows its pattern. The square and its gap
  grow together, so its near edge is the grown gap off the anchor and a
  code on a wall still lies in front of it. Picking reads the drawn
  square, so a click anywhere on the grown code selects it (a 20 cm code
  from 1100 m is about 14 m a side on a 900 px view, 32 m on a phone held
  sideways). It lies at its own height (a code on a wall, laid flat,
  hovers there, over what is lower beneath it), so what stands over it (a
  billboard, a pin, a photo or a model) is hit first from above, and it
  is hit before what lies lower (a billboard laid flat is 0.6 m over its
  station: a code on a wall over it takes the click where the two
  overlap on screen). Over rising ground a grown code can dip into the
  drawn ground, which then hides part of it (not measured on hills).
- **The size on screen, swept** (an earlier build grew codes by the
  storyboard prototype's curve, up to 8 times: a 20 cm code stayed about
  2.7 px from 71 m to 571 m). Swept over 9, 12 and 15 px, from 10 m to the
  camera's 1100 m, at 1440 x 900, 820 x 1180, 844 x 390 and 390 x 844
  (arithmetic; and in the browser, a one-code tour's top view at 10, 30,
  100, 300 and 1100 m, the code measured on the canvas and a screenshot
  of the middle of the view at each):
  - Where growth starts (a 20 cm code): 21 / 16 / 13 m at 9 / 12 / 15 px on
    a 900 px view; 9 / 7 / 6 m on a phone held sideways. Below it the
    printed size is larger and is kept.
  - The finder squares on screen: 2.5 / 3.4 / 4.2 px.
  - The height from which a code (its gap included) reaches farther from
    its anchor on screen than a 15 m found radius: on a 900 px view 1191 /
    894 / 715 m; on a phone held sideways 516 / 387 / 310 m.
  - Measured on the canvas: from 30 m up the code is 9.0 / 12.0 / 15.0 px
    at every view size, from 1.4 to 236 times its printed size; at 10 m it
    keeps its printed 21 px on the desktop and 20 px on the upright phone
    and grows only on the phone held sideways (9.2 / 12.3 / 15.4 px, the
    excess its distance over its depth).
  - Seen: at 9 px a code is a speckled dot; at 12 px a white square with
    dark specks, plainly a code; at 15 px its three finder corners can be
    told apart. At 300 m on a phone held sideways a code 2 m from its
    station overlaps the station's ring at all three sizes, so overlap
    does not choose between them there.
  - The choice, 12 px: the least size at which a code reads as a code and
    not a dot, and the one that reaches past a 15 m radius latest after
    9 px (387 m on a phone held sideways, against 310 m at 15 px).
  - What would reverse it: wanting the finder corners told apart from
    above makes it 15 px (and codes cover their surroundings from about
    310 m on a phone held sideways); nothing measured argues for 9 px,
    which reads as a dot.
    Codes have no gizmo; their point and the inspector's
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
left as it lies; a code laid flat drawn its size on screen from high
above with no cap (its gap with it, picked at its grown size, its corners
for the page's measure, its printed size near or tilted up) and for the
view's own height; where an item and a
code stand, drawn or not; a station's and an item's (a model's) preview
shown and taken back; the selected station's circle amber and a selected
item's station lighter; what is under a ray; names and codes hidden and shown; everything removed on
dispose; `codeQuaternionNue` for a heading and a full rotation;
`focalPxOf`; `codeGrowth`'s size on screen, its printed size near, its
flat weighting, bad input, and a property (at least 1, laid flat exactly
the larger of its printed size and `CODE_SCREEN_PX` on screen, growing
with distance, shrinking as the view tilts up). Real drawing and real
ground: `playwright-tests/editor3d.spec.js`; the code measured on the
canvas at four view sizes: `playwright-tests/editor3d-edit.spec.js`.
