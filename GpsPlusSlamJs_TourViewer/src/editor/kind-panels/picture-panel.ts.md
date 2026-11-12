# `editor/kind-panels/picture-panel.ts` - a picture's panel

## Purpose

A picture's own part of the item inspector: its view as chips (plane,
framed print, cut-out) with one line on what the view does, a cut-out's
tag switch, and a warning when a cut-out's picture has no see-through
parts. Its text fields (title, caption, alt text, credit, year) stay the
dock's (`kinds/edit-kinds.ts`).

## Public API

- `createPicturePanel(deps) -> KindPanel`
  - `deps.setView(id, view)` - a chip's pick (`picture-view:<view>`);
  - `deps.setTag?(id, shown)` - the tag switch (`picture-tag`), drawn
    only for a cut-out and only when the page gives the edit;
  - `deps.seeThrough(path)` - the alpha check (`kinds/picture/picture-alpha.ts`
    through the page's file reader), asked once per image path, when a
    cut-out is drawn or the cut-out chip is pressed;
  - `deps.changed()` - an answer came in: draw again.
- `PICTURE_VIEW_CHOICES`, `OTHER_VIEW_NOTE` (a view the chips do not
  offer, such as a viewpoint view), `NO_ALPHA_WARNING`.

## Invariants and assumptions

- The draw's `key` carries the view, the tag and the check's answer, so
  an answer arriving redraws the dock.
- A check that fails or cannot tell (null) warns nothing: the warning is
  for a known opaque picture only.

## Tests

`picture-panel.test.ts`; the list's row in `kind-panels.test.ts`.
