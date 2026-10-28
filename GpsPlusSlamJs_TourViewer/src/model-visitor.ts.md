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
- `shownModelViews(scene)` - the handles under visible
  `station-content:` groups.
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
select. The styles are in `model-visitor.css`.

## Tests

`model-visitor.test.ts` (jsdom): which models have a card, opening and
closing on taps, note and section stepping, closing when the model goes,
the toy's drag, pinch, reset and put-down, other views ignoring gestures,
the overlay taps, and `stop`.
