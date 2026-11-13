# `kinds/video/video-look.ts` - a free video's drawing

## Purpose

The three.js drawing of a free video in its world view, ported from the
approved station-blocks video prototype's measures:

- `screen` - a dark extruded slab with the clip, a play glyph while it does
  not play, a control bar drawn on a canvas (play, progress, time, sound)
  and a soft ground shadow.
- `cutout` - the clip standing on the ground half a metre forward, turning
  toward the visitor (at most `CUTOUT_MAX_TURN`, 30 degrees), cut out by a
  stacked matte or, without one, softened to a feathered ellipse; the
  editor shows "Needs a stacked-alpha video" over a cutout without one.
- `porthole` - the clip cropped to its centred square in a round brass
  bezel, a progress ring and a halo that glows while the visitor is within
  12 m, with a "Watch" label and the duration.

## Public API

- `LOOK_REFERENCE_WIDTH_M` (1.6), `VIDEO_DEFAULT_ASPECT` (1.25, until the
  clip's own is known), `CUTOUT_MAX_TURN`.
- `VideoWorldView` - `"screen" | "cutout" | "porthole"`.
- `LookState` - what the part tells the look each frame: the clip and
  poster textures, started, playing, progress, time text, sound, the page
  clock and the viewer in the look's parent frame (the part's object), or
  null (a cutout then stands as posed).
- `LookOptions` - view, width, aspect (height per width), stacked, lift
  (the pose's height, to stand a cutout on the ground), edit, and the
  page's `canvasTexture`.
- `videoLook(options)` -> `{ object, tapTarget, show(state), dispose() }`.
- `centredSquare(aspect)` -> `[u, v, w, h]` - the porthole's crop; the
  whole clip for an aspect that is no positive number.

## Invariants & assumptions

- Built at `LOOK_REFERENCE_WIDTH_M` and scaled by `widthM / 1.6`, then
  marked with `markPlaceScale` (`placement/place-scale.ts`): a drawing is
  exactly proportional to its width, which the editor's size preview and
  the placement contract need. The prototype's size floors for small
  screens (bar, padding) are therefore not applied.
- Canvases come from `canvasOf`, null without a document (Node): the
  meshes keep their size and stay unpainted, so tests run without a page.
- `dispose` removes the object and frees every geometry, material and
  texture it made.

## Examples

```ts
const look = videoLook({
  view: "cutout",
  widthM: 2,
  aspect: 16 / 9,
  stacked: true,
  liftM: 0,
  edit: false,
  canvasTexture,
});
part.add(look.object);
look.show({ ...state, viewer: [0, 1.6, 4] });
```

## Tests

- `video-look.test.ts` - proportional size in every view, the cutout's
  clamped turn, the porthole's crop.
- `video-world.test.ts` - a posed cutout is turned by the viewer in its
  own frame.
- `placement/placement.contract.test.ts` - the drawn size against the
  placement rows.
