# `model-views-check.html` - a tour model in each world view

## Purpose

A standalone check page, linked from nothing, that draws one tour model in
one of its world views (`placed`, `ghost`, `hotspots`, `cutaway`, `toy`)
with the visitor's notes, card and toy gestures, in a plain daylight scene
(the views' prototype's sky, fog, room light, hemisphere and sun, on a
flat ground). It exists so that the views can be seen and compared side by
side with their prototype
(`public/prototypes/station-blocks-5-models/`) without an AR session, and
so that the layout e2e can pin the card and the discs.

It is a Vite build entry (`vite.config.ts`), so it is built and reachable
on a deployed branch preview at `/tour/model-views-check.html`; nothing in
the Tour Viewer imports it. Its code is `src/checks/model-views-check.ts`.

## The hook

`window.__modelViewsCheck`:

- `load(glbBase64 | null)` - the `.glb` to draw from now on; null (the
  default) draws a stand-in: a 2 m post with an arm and a clip "swing".
- `show(block)` - draw the model as a model block in a world view says
  (`id`, `kind: "model"`, `view`, `sizeM`, `pose`, and any notes,
  sections or clip). The model is placed directly at `pose` in the page's
  scene (y up), sized by the shared `modelScale` and mounted by
  `mountModelView`, as the visitor's renderer does.
- `lookFrom(eye, target)` - stand the camera at `eye` and look at
  `target` (metres).
- `openNote(i)` - open the shown model's note `i`.
- `state()` - the shown view, the card (hidden, counter, title) and the
  number of discs on screen.

A click on the canvas is a visitor's tap (`createModelVisitor.tapped`).

## What it does not show

The camera image (a plain ground stands in for it), the station's anchor
and pose chain (the model's pose is used directly) and the story.

## Tests

`playwright-tests/model-views.spec.js` (the layout of the card and the
discs at a phone, a phone held sideways and a desktop);
`src/checks/model-views-check.test.ts` (the block check and the field of
view).
