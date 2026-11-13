# `editor/kind-panels/picture-panel.ts` - a picture's panel

## Purpose

A picture's own part of the item inspector: its view as chips (plane,
framed print, cut-out, and the views seen from a viewpoint: then and now,
sharpen, viewer, finder, window) with one line on what the view does, a
cut-out's tag switch, a warning when a cut-out's picture has no
see-through parts, and in a viewpoint view its viewpoint section. Its
text fields (title, caption, alt text, credit, year) stay the dock's
(`kinds/edit-kinds.ts`).

## Public API

- `createPicturePanel(deps) -> KindPanel`
  - `deps.setView(id, view)` - a chip's pick (`picture-view:<view>`);
  - `deps.setTag?(id, shown)` - the tag switch (`picture-tag`), drawn
    only for a cut-out and only when the page gives the edit;
  - `deps.seeThrough(path)` - the alpha check (`kinds/picture/picture-alpha.ts`
    through the page's file reader), asked once per image path, when a
    cut-out is drawn or the cut-out chip is pressed;
  - `deps.changed()` - an answer came in: draw again.
  - `deps.setViewpoint?(id, viewpoint | null)` - the button
    `picture-viewpoint-new` asks for a fresh viewpoint in front of the
    picture (null); absent, no viewpoint section is drawn.
- `OTHER_VIEW_NOTE` (a view the chips do not offer, such as a card),
  `NO_ALPHA_WARNING`. The viewpoint section opens with a one-line note on
  where to stand (internal).

## The viewpoint section

Drawn for a viewpoint view when the page gives `setViewpoint`: the
viewpoint's place (north, eye height, east, m), facing, pitch and lens
(degrees) and depth (m) as number fields (`data-field` `vp-*`, from
`../picture-viewpoint.ts`'s `VIEWPOINT_FIELDS`), which the shell commits
through `inspector-edits.ts`; and a button that stands a fresh viewpoint
in front of the picture ("Stand in front of it", or "... again" over an
existing one). A viewpoint view without a viewpoint shows the button
only. Moving the viewpoint is typing its place; the 3D view has no drag
handle for it, and the fields take no slider yet.

## Invariants and assumptions

- The draw's `key` carries the view, the tag, the check's answer and the
  viewpoint, so an answer arriving or a typed value redraws the dock.
- A check that fails or cannot tell (null) warns nothing: the warning is
  for a known opaque picture only.

## Tests

`picture-panel.test.ts`; the list's row in `kind-panels.test.ts`.
