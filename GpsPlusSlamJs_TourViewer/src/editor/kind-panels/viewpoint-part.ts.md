# `editor/kind-panels/viewpoint-part.ts` - a viewpoint's inspector section

## Purpose

The viewpoint section of a kind's panel, shared by `picture-panel.ts` (its
viewpoint views) and `video-panel.ts` (its stand-here view), so both type a
viewpoint with the same fields, words and buttons.

## Public API

- `ViewpointPartOptions` - `vp` (`ViewpointFacts`, or null for none yet),
  `use` (what the view uses it for), `lookFromAct` (null: no "Look from
  the viewpoint" button) and `freshAct` (the "Stand in front of it" act).
- `viewpointPart(options)` -> the `.isec.pviewpoint` element: a label, the
  note on what a viewpoint is, the use line (`.note.use`), the seven
  `vp-*` number fields in `VIEWPOINT_FIELDS` order (metres to 2 places,
  degrees to 1), the look-from button (only with a viewpoint and an act)
  and the fresh-viewpoint button ("again" once it has one).

## Invariants & assumptions

- It writes nothing itself: the fields are committed by the shell
  (`inspector-edits.ts`, the `vp-` prefix), the buttons by the panel's
  `act` with the acts it passed.
- The picture panel's output is unchanged by the extraction (its tests
  pin the fields, the use line and both acts).

## Examples

```ts
viewpointPart({
  vp: video.viewpoint,
  use: "Used by Stand here: ...",
  lookFromAct: "video-look-from",
  freshAct: "video-viewpoint-new",
});
```

## Tests

- `picture-panel.test.ts` and `video-panel.test.ts` - the fields, their
  values, the use line and the acts, through each panel.
