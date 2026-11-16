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
- `window` - the clip set back 0.38 into a wall opening (a clip with a
  darker inner edge that writes depth), its reveals shaded by vertex
  colours, four timber edge bars (no cross: the frame is left clear), a
  stone surround with a keystone and a sill, and a faint glow spill on the
  ground. The clip is the tap target. Every measure scales with the
  width.
- `standHere` - the clip projected 12 % larger onto the wall in a
  feathered ellipse, shaded by its develop (`stand-here.ts`): a faint
  sepia ghost of the clip itself at 0 (never its poster, which shows
  another moment), the clip at 1; absent (the editor), whole.
  `standHereSpot(viewpoint, canvasTexture)` draws its footprints on the
  ground at the viewpoint (a 1.2 m disc with toes along the viewpoint's
  facing, and a 2.2 m pulse), in the frame it is added to.

## Public API

- `VIDEO_DEFAULT_ASPECT` (1.25, until the clip's own is known),
  `CUTOUT_MAX_TURN`.
- `VideoWorldView` - `"screen" | "cutout" | "porthole" | "window" | "standHere"`.
- `StandHereSpot` / `standHereSpot(viewpoint, canvasTexture)` ->
  `{ object, show(develop, seconds), dispose() }`.
- `LookState` - what the part tells the look each frame: the clip and
  poster textures, started, playing, progress, time text, sound, the page
  clock and the viewer in the look's parent frame (the part's object), or
  null (a cutout then stands as posed), and a stand-here projection's
  develop (absent: whole).
- `LookOptions` - view, width, aspect (height per width), stacked, lift
  (the pose's height, to stand a cutout on the ground), edit, and the
  page's `canvasTexture`.
- `videoLook(options)` -> `{ object, tapTarget, show(state), ground(liftM), dispose() }`;
  `ground` stands the shadow and a cutout's foot `liftM` (the part's own
  metres) below the object, for a folder that draws the part at another
  scale; nonsense and the porthole change nothing. It divides by the
  root's scale as drawn now, not the one it was built at: the editor's
  width drag rescales the root in place (`drawAtExtent`). The folders'
  scale is the part object's, outside the root, and is already out of
  `liftM`, so neither scale is counted twice.
- `centredSquare(aspect)` -> `[u, v, w, h]` - the porthole's crop; the
  whole clip for an aspect that is no positive number.

## Invariants & assumptions

- Built at a reference width of 1.6 m (module-private) and scaled by `widthM / 1.6`, then
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
  clamped turn, the porthole's crop, the window's set-back clip and four
  bars, the stand-here shade by develop, the footprints' place and
  facing, the ground moved and nonsense ignored.
- `video-world.test.ts` - a posed cutout is turned by the viewer in its
  own frame.
- `placement/placement.contract.test.ts` - the drawn size against the
  placement rows.
