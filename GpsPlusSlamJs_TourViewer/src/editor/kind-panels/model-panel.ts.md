# model-panel.ts

## Purpose

A 3D model's panel in the item inspector. It draws the Size section, the view chips, the clip, the notes and the sections from the inspector's model parts, and answers their buttons as model edits or as the 3D view's wait and focus.

## Public API

- `ModelPanelDeps`:
  - `editModel(itemId, edit)`: one undo step, giving `TypedEditOutcome`.
  - `pickAsked(pick | null)`.
  - `focused(focus | null)`.
- `createModelPanel(deps): KindPanel`:
  - `sync` returns null unless the item has model parts. The draw has no kept node, no title, no head buttons and `ownsFields` false. Its parts are Size (when the item has a size), then `.mview`, `.manim`, `.mnotes`, `.msections`.
  - `act` handles `view:<v>`, `anim-autoplay`, `note:<i>`, `section:<i>`, `note-add`, `section-add`, `note-place:<i>`, `section-place:<i>`, `note-delete:<i>`, `section-delete:<i>` and `section-flip:<i>`. For any other act it returns false.
  - `flush` does nothing: its fields (`size`, `anim-name`, `note-title:<i>`, `note-text:<i>`, `section-name:<i>`) are committed by the shell through `inspector-edits.ts`.

## Invariants & assumptions

- The code was moved verbatim from `shell-inspector.ts` (the DOM) and `editor-shell.ts` (`modelAct`), so its behaviour is unchanged.
- Pressing a pick or focus button that is already on turns it off.
- A delete that was written clears the focus and the pick.
- A flip negates the normal with `0 - x`, so a zero stays 0 and never becomes -0.

## Examples

```ts
const panel = createModelPanel({ editModel, pickAsked, focused });
panel.act("view:ghost", item, item.id); // editModel(id, { kind: "view", view: "ghost" })
```

## Tests

`kind-panels.test.ts` (the parts' classes, acts). Through the shell: `../editor-shell/editor-shell.test.ts` (the model's buttons end to end in jsdom).
