# content-placement.ts

## Purpose

Placed content (guided-setup plan M4, DEC-N7/N9): the pure half that turns
what the creator did in AR into `tour.json` records, and the rendering that
the creator's live preview and the visitor's session share.

## Public API

- `newObjectId(random?)` - 12 base-36 characters; the manifest id and the
  content file's stem.
- `mintPin({ id, label, worldNuePosition, zero, nowIso }): TourPin | null` -
  from the reticle's GPS-world NUE position (identity rotation). Null
  without a zero.
- `mintPhoto({ id, cameraPose, alignmentMatrix, zero, imageWidth,
imageHeight, nowIso }): TourPhoto | null` - the camera's RAW odometry pose
  composed through `alignment · WEBXR_TO_NUE · pose` (`qrWorldPoseFromOdom`)
  then minted; `image` is `content/<id>.jpg`. Null without an alignment or a
  zero.
- `objectPoseNue(geo, zero)` - an object's position and rotation in a
  session's NUE frame; a heading-only pose (hand-edited `tour.json`) keeps
  its facing through `rotationFromHeading` (the framework's -heading about
  Up convention) instead of facing East.
- `rotationFromHeading(headingDeg)` - that quaternion.
- `renderTourObjects(objects, { scene, zero, poseOf?, makeLabel, loadPhotoTexture })`
  builds ONE `Group` and adds it to the scene only after the last photo
  decoded (photos decode one at a time - memory), so a session ending
  mid-run owns no stray labels; `dispose` removes the group.
  Details:
  Promise<RenderedTourObjects>` - pins as label objects, photos as capture
planes (`placeCapturedImagePlanes`), all at the scene root; a photo whose
texture fails is skipped and named in `skipped`; a placed 3D model
(format minor 1) is not drawn yet - it never reaches the photo loader and
is left out quietly, NOT named in `skipped`("could not load" would claim a
download failed; a lenient read leaves out what it cannot show the same
way). The renderer milestone that draws models adds an honest line for a
model it cannot show;`dispose()`removes and
frees everything.`root` is the one group every rendered object hangs
under - what a tap in AR is cast against to name the object
(`object-pick.ts`, authoring plan 2026-09-28-0953 M4).
- `renderTourStation(station, { scene, zero, makeLabel, loadPhotoTexture, alive? })
-> Promise<RenderedTourObjects>` - the visitor's playback of ONE station of
  a version 3 tour (tour editor plan 2026-10-17-1816, W3; one call per
  station since visitor plan 2026-10-18-2349 M2, so each station is drawn
  and freed on its own, `station-content.ts`): a `Group` at the station's
  geo pose in the session's NUE (`objectPoseNue`), its pins and photos as
  children at their LOCAL poses (`[north, up, east]` and a rotation
  relative to the station), added to `scene` once every photo decoded;
  `root` is that group. A station without items gives an empty one. The
  same rendering (`renderContent`) as `renderTourObjects`, so labels,
  photo planes, `skipped` and `dispose` behave the same. `alive()`
  turning false stops the decode loop: no further photo is decoded, and the
  caller disposes what came back. A throw part-way (a label or plane
  constructor) frees the labels and decoded photos made so far, then goes
  on (the caller gets the rejection and nothing to dispose).
- Every rendered pin's label and photo's plane carries its object's id in
  `userData.objectId`, so a pointer over the 3D editor can say which item
  it is over (`editor3d-stations.ts`, `pick`).

## Invariants & assumptions

- **Frames.** The reticle's world position under the aligned world group is
  already GPS-world NUE (the framework's `startHitTestReticle` contract).
  The camera pose is raw WebXR/odometry, so it takes the LEADING basis
  form; the trailing form is for replayed state, and mixing them is the 90°
  yaw bug the geo-join review caught. Pinned by bearing in the tests.
- GPS-world `y` IS absolute altitude (the stack's convention); the records
  carry it as `geo.alt`.
- Rendering is at the scene root in the session's NUE, like the photo
  planes - unless the caller passes `poseOf`, a pose per object in the
  frame of the `scene` it hands in. The creator's previews of the running
  AR visit use it to sit under the AR world group at their odometry pose,
  so they stay rigid while GPS re-solves (authoring plan 2026-09-28-0953
  §3.2, M2c); a geo-derived pose under the world group would apply the
  alignment twice; `makeLabel` and `loadPhotoTexture` are injected because node has
  no canvas and the photo bytes live in different places for the creator
  (a Blob in memory) and the visitor (an archive entry).

- **A station's frame against the session's.** A station's group stands
  in the session's tangent plane, its items in the station's own. The two
  differ by the Earth's curvature between the session's zero and the
  station. Measured: 0 at the zero, 0.7 mm at 100 m, 6.9 mm at 1 km,
  3.4 cm at 5 km, growing linearly. The test asserts 1 mm + 12 mm per km
  of the zero's distance and the turn within 0.001 degrees. A visitor's
  zero is their first GPS fix, normally within a few hundred metres of a
  station.

## Examples

```ts
const pin = mintPin({
  id: newObjectId(),
  label,
  worldNuePosition,
  zero,
  nowIso,
});
const preview = await renderTourObjects(objects, {
  scene,
  zero,
  makeLabel,
  loadPhotoTexture,
});
```

## Tests

`viewer-content-alignment.test.ts` (authoring plan M2d, decision D10a) -
through the real call site (`viewer-placement.ts`) and the real QR
controller: the pin is rendered on the first voted lock, at the scene root
(not under the odometry group or an anchor), with that lock's votes already
in the store, and is never re-placed while the scan's votes move it in the
visitor's view. At B = 8 m the hard trim makes the result exact (the case
pins that the whole correction arrives, not an accuracy); at B = 3 m over a
longer walk the pin shows the alignment's GPS/vote compromise (between 5 mm
and 0.1 m, measured 24 mm).

`content-placement.test.ts` - the pin round trip (mint → NUE) as a property
over positions; the photo's frame direction pinned by bearing against the
framework's basis constant; refusals without zero/alignment; the id shape
(property); rendering with a fake scene: counts, a skipped photo, a placed
model left out quietly (the photo loader never asked, no "could not
load" in the status segment), disposal, what a throw part-way frees (the
decoded photo and the label made so far), and a
caller's own pose and frame (`poseOf`) for pins and photos. For
`renderTourStation`: the group structure (the station's group, the items
as its children, each tagged with its object's id), no further decode once `alive()` is false, and the
property that the local poses
taken from the settled geo reproduce each object's direct AR pose within
the stated bound, swept over zero distances of 0, 100, 1000 and 5000 m.
