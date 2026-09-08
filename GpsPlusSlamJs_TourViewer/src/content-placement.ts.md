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
- `renderTourObjects(objects, { scene, zero, makeLabel, loadPhotoTexture })`
  builds ONE `Group` and adds it to the scene only after the last photo
  decoded (photos decode one at a time - memory), so a session ending
  mid-run owns no stray labels; `dispose` removes the group.
  Details:
  Promise<RenderedTourObjects>` - pins as label objects, photos as capture
planes (`placeCapturedImagePlanes`), all at the scene root; a photo whose
texture fails is skipped and named in `skipped`; `dispose()` removes and
  frees everything.

## Invariants & assumptions

- **Frames.** The reticle's world position under the aligned world group is
  already GPS-world NUE (the framework's `startHitTestReticle` contract).
  The camera pose is raw WebXR/odometry, so it takes the LEADING basis
  form; the trailing form is for replayed state, and mixing them is the 90°
  yaw bug the geo-join review caught. Pinned by bearing in the tests.
- GPS-world `y` IS absolute altitude (the stack's convention); the records
  carry it as `geo.alt`.
- Rendering is at the scene root in the session's NUE, like the photo
  planes; `makeLabel` and `loadPhotoTexture` are injected because node has
  no canvas and the photo bytes live in different places for the creator
  (a Blob in memory) and the visitor (an archive entry).

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

`content-placement.test.ts` - the pin round trip (mint → NUE) as a property
over positions; the photo's frame direction pinned by bearing against the
framework's basis constant; refusals without zero/alignment; the id shape
(property); rendering with a fake scene: counts, a skipped photo, disposal.
