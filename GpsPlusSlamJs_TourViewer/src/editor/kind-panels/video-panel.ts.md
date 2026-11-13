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

## Public API

- `VideoPanelDeps` - `writeView(id, view)` and `writeChoice(id, field,
value)`, each one undo step (the shell's `edits.view` and `edits.block`).
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

## Examples

```ts
const panel = createVideoPanel({ writeView, writeChoice });
panel.act("video-set:start:near", item, "video-1");
```

## Tests

- `video-panel.test.ts` (jsdom) - the views offered, the pressed chips,
  writes and no-writes, the loop switch, the captions line, acts left to
  the shell.
- `kind-panels.test.ts` - the list gives the video its panel.
