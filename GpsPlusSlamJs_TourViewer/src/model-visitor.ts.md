# model-visitor.ts

## Purpose

The visitor's side of a station's 3D models: each frame it updates every
shown model's view and its notes' discs; a tap opens a note or the model's
own card; while a toy's card is open, the screen's pinches and drags act
on the toy. `main.ts` wires it into the station ticks and the visitor's
taps.

## Public API

- `mountModelVisitorDom(parent)` - builds, under the AR overlay's root,
  `svg#note-leaders`, `div#note-markers`, `div#model-gestures` (hidden)
  and `section#model-card` (hidden) with its close button, counter, title,
  text and a row of Previous / Back to its place / Next. Each element's
  `data-testid` is its id.
- `createModelVisitor({ dom, scene(), camera(), pick })` -> `ModelVisitor`
  - `tick(nowMs)` - the views' `update`, the discs' `sync`; closes the
    card when its model is no longer shown.
  - `tapped(tap)` - picks among the shown models that have a card; true
    when it opened one (the pin sheet then closes), false otherwise (the
    card closes and the tap is the pin sheet's).
  - `openNote(handle, index)` - opens a note's card; an index out of range
    does nothing.
  - `close()`, `stop()` (the card closed, every disc removed), `openKey()`
    (`"note:<key>"`, `"model:<id>"` or null).
- `shownModelViews(scene)` - the mounted handles (`mountedModelViews`)
  whose model is shown under a `station-content:` group of `scene`, in
  mounting order. It runs every frame, so it climbs each model's
  ancestors instead of walking the scene; a disposed view is left out.
- The section chip (`button#model-section-chip`, part of the built DOM):
  while no card is open and a cutaway with sections is shown (the nearest
  to the camera), it reads "Section 1 of 3: <name>"; a tap opens that
  model's card. It sits in the card's place, above the note layers
  (z 30), and is hidden while the card is open, so the two never stand
  together. Without it nothing on the screen said a cutaway had sections.
- `hasModelCard(handle)` - a toy, a cutaway with sections, or a model with
  a title.

## Card states

- A note: "Note i of n", its title and text; Previous / Next step the
  notes.
- A cutaway with sections: "Section i of n" and its name; Previous / Next
  step the cut.
- A toy: "In your hand", "Pinch to resize it, drag to move it.", and
  "Back to its place", enabled once the toy was moved or resized.
- Otherwise: "3D model" and the model's title.

## Gesture layer

Shown only while a toy's card is open. One finger drags
(`toyDragMetres`), two pinch (`pinchedToyFactor`), a tap (under 8 px of
travel) puts the toy down. `pin-sheet.ts` lists `.model-card` and
`.model-gestures` among the overlay's taps, so none of them is an AR
select. The styles are in `model-visitor.css`, which stacks the layer
(z 15) below the note leaders and discs (z 20), so a disc stays tappable
while it is shown, and the card (z 31) above them all.

## Tests

`model-visitor.test.ts` (jsdom): which models have a card, opening and
closing on taps, note and section stepping, closing when the model goes,
the toy's drag, pinch, reset and put-down, other views ignoring gestures,
the overlay taps, the section chip, `stop`, and the stylesheet's stacking order.
