# `editor/kind-panels/video-panel.ts` - a free video's panel

## Purpose

The video's own part of the item inspector (`kind-panel.ts`): its view
(screen, cutout, porthole) and its choices in that view as chips - how it
starts, whether it starts with its sound, and a cutout's background - with
a line saying what the view does, and a note under a cutout as filmed that
a clean edge needs a stacked-alpha video. Its loop is one switch
(`role="switch"`, `aria-checked`) whose press writes the other value.
Under them a line says how many caption cues the WebVTT read to, with what
was left out, or why nothing was read (`captionsStatus`). The `near`
start's distance and the captions are fields the dock types (`KIND_EDIT`
`fields`); the distance is listed only while the start is `near`.
Above them, kept across the dock's draws, is the clip's preview
(`video-preview.ts`): its thumbnail, length and size, Play, a scrub bar
and "Use current frame", which makes the frame shown its poster.

## Public API

- `VideoPanelDeps` - `writeView(id, view)` and `writeChoice(id, field,
value)`, each one undo step (the shell's `edits.view` and `edits.block`);
  `load(path)` (a tour file, for the preview) and `writePoster(id, image)`
  (the shell's `edits.poster`: one undo step, with a refusal shown as a toast).
- `VIDEO_VIEW_CHOICES` - the format's free video views with their labels.
- `createVideoPanel(deps)` -> `KindPanel`.
  - Acts: `video-view:<view>` and `video-set:<field>:<value>`.

## Invariants & assumptions

- It draws from the inspector's `video` part (`InspectorVideo`: the view
  and `blockChoices`), so a choice the view does not read is not drawn.
- A press of the chip in use writes nothing (no empty undo step); a choice
  not among the video's in its view, and any other act, is left to the
  shell (`act` returns false).
- The values and the refusal are `block-fields.ts`'s (`blockFieldEdit`):
  the panel only says which was pressed.
- One preview per block and clip path, kept (`KindPanelDraw.kept`) while
  they stay the same; another clip or no selection disposes it. A video
  whose file the tour does not list (`clipPath` null) has none.

## Compared with the video prototype (`station-blocks-4-video`)

Accepted as intended, so not built:

- The inspector's head is the dock's own (title, kind, station), not the
  prototype's "Video block" heading and its required-view tag.
- Background (none / stacked alpha) is offered only in a cutout, the one
  view that reads it; the prototype lists it greyed out for every view.
- The sound chips say "Muted" / "With sound" for the format's values,
  where the prototype has a bare "off" / "on".
- The position is the dock's Place section (north, up, east and a
  heading relative to the station), not the prototype's x, y, z grid.
- Placing in the 3D view uses the editor's existing gizmo (move, turn,
  the white dots for the width), not the prototype's own handles.
- There is no hint bar under the 3D view naming the handles: the editor's
  status line does that for every kind.
- The phone layout is the dock's (sheets and tabs), which belongs to the
  docking work, not the prototype's stacked panels.
- The preview is one clip thumbnail whose poster shows before it plays.
  The prototype draws the clip and the poster as two separate thumbnails
  and adds the frame rate and pixel size, which the editor does not read.

Waiting for the viewpoint work: the window view, the stand-here view and
the viewpoint fields (position, heading, field of view, "Look from
viewpoint").

Out of scope, filed as a follow-up: the prototype's creator AR mode
(placing the video while standing at the station).

## Examples

```ts
const panel = createVideoPanel({ writeView, writeChoice });
panel.act("video-set:start:near", item, "video-1");
```

## Tests

- `video-panel.test.ts` (jsdom) - the views offered, the pressed chips,
  writes and no-writes, the loop switch, the captions line, one preview
  kept per clip, acts left to the shell.
- `video-preview.test.ts` - the preview itself.
- `kind-panels.test.ts` - the list gives the video its panel.
