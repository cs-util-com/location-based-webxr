# model-views.ts

## Purpose

Mounts a tour model in its world view - `placed`, `ghost`, `hotspots`,
`cutaway` or `toy` - on the model the renderer already sized and posed,
and gives the visitor's page one handle per model for its notes, its
sections, its toy and its clip. `content-placement.ts` calls it for every
drawn model; `model-visitor.ts` drives the handles.

## Public API

- `TourModelBlock` - the model member of the framework's `TourBlock`.
- `ModelViewEnv { enableClipping(): void }` - what a cutaway needs from
  the page: the renderer's local clipping switch.
- `mountModelView(model, block, baseScale, env?) -> ModelViewHandle`
  - `placed`: nothing changes but the clip (see below).
  - `ghost`: every mesh's material is replaced by the shared ghost shader
    (a fresnel glass with a soft ground fade and an appear-in by
    `uAppear`) with a depth-only child so it hides what is behind it once.
  - `hotspots`: the notes are shown (by `note-markers.ts`); the clip is held
    at rest so a note points at what it names.
  - `cutaway`: each material clips by one plane and draws front faces;
    a back-face child fills the cut in the material's own colour
    (`sectionColour`), and a thin frame marks the cut. Without `sections`
    the cut faces the camera through the model's centre, eased each frame;
    with 1-4 named `sections` the cut is the current section's plane.
  - `toy`: the model at its pose, at `baseScale * toyFactor()`; the visitor
    can resize (`pinchToy`), move (`moveToy`) and put it back
    (`resetToy`).
- `ModelViewHandle`
  - `blockId`, `view`, `block`, `model`, `notes` (the block's
    annotations).
  - `notePoints()` - each note's surface point, its marker point (out
    along its normal by `clamp(0.13 * native size * scale, 0.04, 4)`)
    and its world normal.
  - `section()` / `setSection(i)` - the current section; `setSection`
    wraps and ignores a non-integer.
  - `toyFactor()`, `pinchToy(fromPx, toPx)`, `moveToy(dx, dz)` (world
    metres, turned into the parent's frame), `resetToy()`, `toyMoved()`.
  - `update(dtS, camera)` - the clip and the facing cut; call it once a
    frame.
  - `dispose()` - gives the meshes back their own materials, removes every
    added child and frees what the view made, stops the clip.
- `sectionColour(material)` - a material's own colour, else a warm brass.
- `modelViewOf(object)` - the handle kept in `userData.modelView`, or null.

## Invariants

- Every view scales through the tour's `modelScale`: `baseScale` is the
  scale the renderer set; only a toy multiplies it, by its own factor.
- Notes are in the model's space, so they survive an asset swap that keeps
  the model's size and pose.
- The clip (`animation.name`) plays only with `autoplay`, never in
  `hotspots`; a missing clip name plays nothing (no error).
- A material's clipping plane is in world space and keeps the side its
  normal points to, so a section's plane is built from the negated
  normal (a section's normal names the side that is cut away). It is
  placed again every `update`, because a station moves after its content
  is drawn (its anchor is refined).
- `dispose` is idempotent; the renderer calls it before freeing the
  model's resources.

## Example

```ts
const view = mountModelView(model, block, modelScale(model, block.sizeM), {
  enableClipping: () => (renderer.localClippingEnabled = true),
});
model.userData["modelView"] = view;
// each frame
view.update(dtS, camera);
```

## Tests

`model-views.test.ts`: placed untouched; the ghost's materials and their
return; the facing cut and its easing; sections in a rotated parent and after the parent moves; note
points; notes after a file swap; the clip held in hotspots; the toy's
factor, cap, move and reset.
