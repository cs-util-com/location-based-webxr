# editor3d-gizmo.ts

## Purpose

The gizmo's drawing in the 3D view (the design's): a ring round an item, a
station's or a model's four white dots, a turn knob on a stalk along the
heading, and a move arrow lying on the ground in the middle. One set for
the scene, placed on the selection each frame from its layout
(`gizmo-maths.ts`).

## Public API

- `drawGizmoPictures()` -> `GizmoPictures` (`dot`, `knob`, `move`): canvas
  textures in the design's amber and white, each with a transparent
  margin. Throws where the browser has no 2D canvas.
- `createGizmo(parent, pictures)` -> the gizmo, its parts added to
  `parent` hidden:
  - `update(frame | null)`: placed from `frame.layout`; the knob and the
    dots on the ground under them (`frame.groundY`, a little above), the
    ring and the disc just over the centre; sprites at their pixel size
    (`frame.spritePerPx`), the handle in `frame.hovered` 1.15 times larger
    and the move arrow fully opaque when it is the one. Null hides it all.
  - `parts` - `ring`, `disc`, `bar`, `knob`, `dots` (the editing reads the
    disc for its hit test, the page's checks the others).
  - `dispose()`: out of the scene, geometries, materials and pictures
    freed.
- Types `GizmoPictures`, `GizmoFrame` (the gizmo itself is `ReturnType<typeof createGizmo>`).

## Invariants & assumptions

- A station has no ring (its found-radius circle is the tour layer's) and
  a pin or a photo no dots.
- Drawn over everything (no depth test), so a handle behind a house can
  still be grabbed.
- The sprites have no size attenuation: their scale is pixels times
  `2 tan(fov / 2) / the view's height`.
- A layout that is not `posable` (a locked station) draws its ring and radius dots only: the disc, the knob and the bar stay hidden.

## Examples

```ts
const gizmo = createGizmo(scene, drawGizmoPictures());
gizmo.update({ layout, spritePerPx, groundY, hovered: "turn" });
```

## Tests

`editor3d-gizmo.test.ts` (plain textures, Node has no canvas): a
station's knob, dots and disc where the layout has them and no ring; a
pin's ring and no dots, the hovered knob larger; everything hidden
without a selection and out of the scene once disposed. The on-screen
sizes in a browser: `playwright-tests/editor3d-edit.spec.js`.

A locked station's drawing is checked in `editor3d-edit.spec.js` (no knob and no middle on the screen, the dots shown).
